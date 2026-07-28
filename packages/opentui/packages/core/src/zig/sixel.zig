// Sixel graphics protocol — RGBA → DCS sixel stream for PixelBuffer patches.
// The palette is capped at the Sixel-standard 256 registers, but overflow colors
// map to their nearest emitted register instead of collapsing to the background.

const std = @import("std");
const ansi = @import("ansi.zig");
const Allocator = std.mem.Allocator;

const MAX_PALETTE: usize = 256;

fn colorDistance(color: [3]u8, r: u8, g: u8, b: u8) u32 {
    const dr = @as(i32, color[0]) - @as(i32, r);
    const dg = @as(i32, color[1]) - @as(i32, g);
    const db = @as(i32, color[2]) - @as(i32, b);
    return @intCast(dr * dr + dg * dg + db * db);
}

fn nearestPaletteIndex(palette: []const [3]u8, r: u8, g: u8, b: u8) u16 {
    std.debug.assert(palette.len > 0);
    var index: usize = 0;
    var distance = colorDistance(palette[0], r, g, b);
    for (palette[1..], 1..) |candidate, candidate_index| {
        const candidate_distance = colorDistance(candidate, r, g, b);
        if (candidate_distance < distance) {
            index = candidate_index;
            distance = candidate_distance;
        }
    }
    return @intCast(index);
}

pub const IMAGE = struct {
    /// Encode raw RGBA (`width * height * 4`) to sixel and write at cursor (x,y).
    ///
    /// `cell_w`/`cell_h` reserve layout space for delete/clear only — they must
    /// NOT crush the bitmap to 1 sixel-column-per-cell. Modern terminals
    /// (Windows Terminal, xterm) map 1 sixel pixel ≈ 1 screen pixel; callers
    /// size RGBA to `cols * cellPxW` so the image fills the reserved cells.
    pub fn create(
        writer: anytype,
        id: u32,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        data: []const u8,
        cell_w: u32,
        cell_h: u32,
        allocator: Allocator,
    ) void {
        _ = id;
        _ = cell_w;
        _ = cell_h;
        if (width == 0 or height == 0) return;
        const expected = @as(usize, width) * @as(usize, height) * 4;
        if (data.len < expected) return;

        // Encode at source resolution (pad height to a sixel band). Do not
        // downscale to cell_w × cell_h*6 — that produced stamp-sized images.
        const target_w = width;
        const target_h: u32 = @max(6, ((height + 5) / 6) * 6);

        const scaled = scaleRgba(data, width, height, target_w, target_h, allocator) catch return;
        defer allocator.free(scaled);

        const encoded = encode(scaled, target_w, target_h, allocator) catch return;
        defer allocator.free(encoded);

        ansi.ANSI.moveToOutput(writer, x, y) catch {};
        writer.writeAll(encoded) catch {};
    }

    /// Sixel has no image-id delete. Clear the reserved cell region with spaces.
    pub fn delete(writer: anytype, x: u32, y: u32, cell_w: u32, cell_h: u32) void {
        const cols = if (cell_w > 0) cell_w else 1;
        const rows = if (cell_h > 0) cell_h else 1;
        var row: u32 = 0;
        while (row < rows) : (row += 1) {
            ansi.ANSI.moveToOutput(writer, x, y + row) catch {};
            var col: u32 = 0;
            while (col < cols) : (col += 1) {
                writer.writeAll(" ") catch {};
            }
        }
    }
};

fn scaleRgba(
    src: []const u8,
    src_w: u32,
    src_h: u32,
    dst_w: u32,
    dst_h: u32,
    allocator: Allocator,
) ![]u8 {
    if (src_w == dst_w and src_h == dst_h) {
        return try allocator.dupe(u8, src[0 .. @as(usize, src_w) * @as(usize, src_h) * 4]);
    }

    const out = try allocator.alloc(u8, @as(usize, dst_w) * @as(usize, dst_h) * 4);
    errdefer allocator.free(out);

    var y: u32 = 0;
    while (y < dst_h) : (y += 1) {
        const sy = @min(src_h - 1, (y * src_h) / dst_h);
        var x: u32 = 0;
        while (x < dst_w) : (x += 1) {
            const sx = @min(src_w - 1, (x * src_w) / dst_w);
            const si = (@as(usize, sy) * @as(usize, src_w) + @as(usize, sx)) * 4;
            const di = (@as(usize, y) * @as(usize, dst_w) + @as(usize, x)) * 4;
            out[di] = src[si];
            out[di + 1] = src[si + 1];
            out[di + 2] = src[si + 2];
            out[di + 3] = src[si + 3];
        }
    }
    return out;
}

/// Encode RGBA to a complete sixel DCS (`\x1bPq` … `\x1b\\`).
pub fn encode(rgba: []const u8, width: u32, height: u32, allocator: Allocator) ![]u8 {
    if (width == 0 or height == 0) return error.InvalidImage;
    const expected = @as(usize, width) * @as(usize, height) * 4;
    if (rgba.len < expected) return error.InvalidImage;

    const sixel_rows = ((height + 5) / 6) * 6;
    const pixel_count = @as(usize, width) * @as(usize, sixel_rows);

    var indices = try allocator.alloc(u16, pixel_count);
    defer allocator.free(indices);

    // palette entries as packed RGB888; index map key = 5-6-5
    var palette: [MAX_PALETTE][3]u8 = undefined;
    var palette_len: usize = 0;
    var key_to_idx = std.AutoHashMap(u16, u16).init(allocator);
    defer key_to_idx.deinit();

    var py: u32 = 0;
    while (py < sixel_rows) : (py += 1) {
        var px: u32 = 0;
        while (px < width) : (px += 1) {
            const pidx = @as(usize, py) * @as(usize, width) + @as(usize, px);
            if (py >= height) {
                indices[pidx] = 0;
                if (palette_len == 0) {
                    palette[0] = .{ 0, 0, 0 };
                    palette_len = 1;
                    try key_to_idx.put(0, 0);
                }
                continue;
            }
            const si = (@as(usize, py) * @as(usize, width) + @as(usize, px)) * 4;
            const r = rgba[si];
            const g = rgba[si + 1];
            const b = rgba[si + 2];
            const key: u16 = (@as(u16, r >> 3) << 11) | (@as(u16, g >> 2) << 5) | @as(u16, b >> 3);

            const gop = try key_to_idx.getOrPut(key);
            if (!gop.found_existing) {
                if (palette_len >= MAX_PALETTE) {
                    // Anti-aliased diagrams exceed 256 5-6-5 bins. Preserve their
                    // edges by mapping each new bin to the closest emitted color.
                    gop.value_ptr.* = nearestPaletteIndex(palette[0..palette_len], r, g, b);
                } else {
                    const idx: u16 = @intCast(palette_len);
                    gop.value_ptr.* = idx;
                    palette[palette_len] = .{
                        @intCast(@as(u16, r >> 3) * 255 / 31),
                        @intCast(@as(u16, g >> 2) * 255 / 63),
                        @intCast(@as(u16, b >> 3) * 255 / 31),
                    };
                    palette_len += 1;
                }
            }
            indices[pidx] = gop.value_ptr.*;
        }
    }

    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(allocator);
    // Chafa-compatible Sixel header: declare RGB mode plus an explicit 1:1
    // raster. Without this, terminals are free to assume legacy dot geometry.
    try out.appendSlice(allocator, "\x1bP0;1;0q");
    try std.fmt.format(out.writer(allocator), "\"1;1;{d};{d}", .{ width, sixel_rows });

    var pi: usize = 0;
    while (pi < palette_len) : (pi += 1) {
        const pr = @as(u32, palette[pi][0]) * 100 / 255;
        const pg = @as(u32, palette[pi][1]) * 100 / 255;
        const pb = @as(u32, palette[pi][2]) * 100 / 255;
        try std.fmt.format(out.writer(allocator), "#{d};2;{d};{d};{d}", .{ pi, pr, pg, pb });
    }

    const bands = sixel_rows / 6;
    var band: u32 = 0;
    while (band < bands) : (band += 1) {
        const base_y = band * 6;

        // color_idx → column bitmasks (length = width)
        var color_bands = std.AutoHashMap(u16, []u8).init(allocator);
        defer {
            var it = color_bands.iterator();
            while (it.next()) |e| {
                allocator.free(e.value_ptr.*);
            }
            color_bands.deinit();
        }

        var x: u32 = 0;
        while (x < width) : (x += 1) {
            var bit: u3 = 0;
            while (bit < 6) : (bit += 1) {
                const y = base_y + bit;
                if (y >= height) continue;
                const pidx = @as(usize, y) * @as(usize, width) + @as(usize, x);
                const color_idx = indices[pidx];
                if (color_idx >= palette_len) continue;

                const gop = try color_bands.getOrPut(color_idx);
                if (!gop.found_existing) {
                    const mask = try allocator.alloc(u8, width);
                    @memset(mask, 0);
                    gop.value_ptr.* = mask;
                }
                gop.value_ptr.*[x] |= @as(u8, 1) << bit;
            }
        }

        var cit = color_bands.iterator();
        while (cit.next()) |entry| {
            try std.fmt.format(out.writer(allocator), "#{d}", .{entry.key_ptr.*});
            for (entry.value_ptr.*) |code| {
                try out.append(allocator, 0x3f + code);
            }
            try out.append(allocator, '$');
        }
        try out.append(allocator, '-');
    }

    try out.appendSlice(allocator, "\x1b\\");
    return try out.toOwnedSlice(allocator);
}

test "sixel encode solid red 2x2" {
    const allocator = std.testing.allocator;
    // 2x2 red RGBA
    const pixels = [_]u8{
        255, 0, 0, 255, 255, 0, 0, 255,
        255, 0, 0, 255, 255, 0, 0, 255,
    };
    const encoded = try encode(&pixels, 2, 2, allocator);
    defer allocator.free(encoded);

    try std.testing.expect(std.mem.startsWith(u8, encoded, "\x1bP0;1;0q\"1;1;2;6"));
    try std.testing.expect(std.mem.endsWith(u8, encoded, "\x1b\\"));
    try std.testing.expect(std.mem.indexOf(u8, encoded, "#0;2;") != null);
}

test "sixel overflow chooses the nearest emitted palette color" {
    const palette = [_][3]u8{ .{ 0, 0, 0 }, .{ 255, 255, 255 }, .{ 255, 0, 0 } };
    try std.testing.expectEqual(@as(u16, 1), nearestPaletteIndex(&palette, 230, 235, 240));
    try std.testing.expectEqual(@as(u16, 2), nearestPaletteIndex(&palette, 245, 10, 10));
}

test "sixel encode empty rejects" {
    const allocator = std.testing.allocator;
    try std.testing.expectError(error.InvalidImage, encode(&[_]u8{}, 0, 0, allocator));
}
