const std = @import("std");
const ansi = @import("ansi.zig");
const buf = @import("buffer.zig");
const gp = @import("grapheme.zig");
const FontRasterizer = @import("font_raster.zig").FontRasterizer;
const Terminal = @import("terminal.zig");
const logger = @import("logger.zig");

pub const RasterViewport = struct {
    pub const Cursor = struct {
        x: u32,
        y: u32,
        visible: bool,
        style: Terminal.CursorStyle,
        color: buf.RGBA,
    };

    allocator: std.mem.Allocator,
    font: FontRasterizer,
    pixels: []u8 = &.{},
    width: u32 = 0,
    height: u32 = 0,
    cell_width: u32 = 0,
    cell_height: u32 = 0,

    pub fn init(allocator: std.mem.Allocator) !RasterViewport {
        return .{ .allocator = allocator, .font = try FontRasterizer.init() };
    }

    pub fn deinit(self: *RasterViewport) void {
        self.font.deinit();
        if (self.pixels.len > 0) self.allocator.free(self.pixels);
    }

    pub fn render(
        self: *RasterViewport,
        cells: *const buf.OptimizedBuffer,
        media: *const buf.PixelBuffer,
        pool: *gp.GraphemePool,
        cell_width: u32,
        cell_height: u32,
        background: buf.RGBA,
        cursor: Cursor,
    ) ![]const u8 {
        if (cell_width == 0 or cell_height == 0) return error.InvalidCellGeometry;
        const width = cells.width * cell_width;
        const height = cells.height * cell_height;
        const byte_len: usize = @intCast(@as(u64, width) * @as(u64, height) * 4);
        if (self.pixels.len != byte_len) {
            if (self.pixels.len > 0) self.allocator.free(self.pixels);
            self.pixels = try self.allocator.alloc(u8, byte_len);
        }
        self.width = width;
        self.height = height;
        self.cell_width = cell_width;
        self.cell_height = cell_height;
        try self.font.setPixelHeight(@max(1, cell_height - 2));

        self.fill(background);
        for (0..cells.height) |y| {
            for (0..cells.width) |x| {
                const cell = cells.get(@intCast(x), @intCast(y)) orelse continue;
                self.fillRect(@intCast(x * cell_width), @intCast(y * cell_height), cell_width, cell_height, cell.bg);
                if (gp.isContinuationChar(cell.char) or cell.char == buf.DEFAULT_SPACE_CHAR) continue;
                const glyph_x: i32 = @intCast(x * cell_width);
                const baseline: i32 = @intCast((y + 1) * cell_height - 2);
                if (gp.isGraphemeChar(cell.char)) {
                    try self.paintGrapheme(pool, cell.char, glyph_x, baseline, cell.fg);
                    continue;
                }
                try self.paintCodepoint(cell.char, glyph_x, baseline, cell.fg);
            }
        }
        for (media.patches.items) |patch| self.blitPatch(patch);
        self.drawCursor(cursor);
        return self.pixels;
    }

    fn paintGlyph(context: anytype, glyph: anytype) void {
        const dst_x = context.x + glyph.left;
        const dst_y = context.baseline - glyph.top;
        for (0..glyph.height) |y| {
            for (0..glyph.width) |x| {
                const alpha = glyph.data[y * glyph.stride + x];
                if (alpha == 0) continue;
                context.viewport.blendPixel(dst_x + @as(i32, @intCast(x)), dst_y + @as(i32, @intCast(y)), context.color, alpha);
            }
        }
    }

    fn paintCodepoint(self: *RasterViewport, codepoint: u32, x: i32, baseline: i32, color: buf.RGBA) !void {
        _ = try self.font.withGlyph(codepoint, .{
            .viewport = self,
            .x = x,
            .baseline = baseline,
            .color = color,
        }, paintGlyph);
    }

    fn paintGrapheme(self: *RasterViewport, pool: *gp.GraphemePool, encoded: u32, x: i32, baseline: i32, color: buf.RGBA) !void {
        const bytes = pool.get(gp.graphemeIdFromChar(encoded)) catch |err| {
            logger.warn("bug: raster viewport could not resolve grapheme pool entry: {}", .{err});
            return;
        };
        var offset: usize = 0;
        while (offset < bytes.len) {
            const sequence_len = std.unicode.utf8ByteSequenceLength(bytes[offset]) catch {
                logger.warn("bug: raster viewport received malformed grapheme UTF-8", .{});
                return;
            };
            if (offset + sequence_len > bytes.len) {
                logger.warn("bug: raster viewport received truncated grapheme UTF-8", .{});
                return;
            }
            const codepoint = std.unicode.utf8Decode(bytes[offset .. offset + sequence_len]) catch {
                logger.warn("bug: raster viewport could not decode grapheme UTF-8", .{});
                return;
            };
            try self.paintCodepoint(codepoint, x, baseline, color);
            offset += sequence_len;
        }
    }

    fn fill(self: *RasterViewport, color: buf.RGBA) void {
        for (0..@as(usize, @intCast(self.width * self.height))) |index| self.writePixel(index, color);
    }

    fn fillRect(self: *RasterViewport, x: u32, y: u32, width: u32, height: u32, color: buf.RGBA) void {
        const right = @min(self.width, x + width);
        const bottom = @min(self.height, y + height);
        for (y..bottom) |py| for (x..right) |px| self.writePixel(@as(usize, @intCast(py * self.width + px)), color);
    }

    fn fillRectAlpha(self: *RasterViewport, x: u32, y: u32, width: u32, height: u32, color: buf.RGBA, alpha: u8) void {
        const right = @min(self.width, x + width);
        const bottom = @min(self.height, y + height);
        for (y..bottom) |py| for (x..right) |px| self.blendPixel(@intCast(px), @intCast(py), color, alpha);
    }

    fn blitPatch(self: *RasterViewport, patch: buf.PixelPatch) void {
        const origin_x = patch.x * self.cell_width;
        const origin_y = patch.y * self.cell_height;
        for (0..patch.height) |y| {
            if (origin_y + y >= self.height) break;
            for (0..patch.width) |x| {
                if (origin_x + x >= self.width) break;
                const source = (y * patch.width + x) * 4;
                self.blendPixel(@intCast(origin_x + x), @intCast(origin_y + y), .{ patch.data[source], patch.data[source + 1], patch.data[source + 2], 255 }, patch.data[source + 3]);
            }
        }
    }

    fn drawCursor(self: *RasterViewport, cursor: Cursor) void {
        if (!cursor.visible or cursor.x == 0 or cursor.y == 0) return;
        const x = (cursor.x - 1) * self.cell_width;
        const y = (cursor.y - 1) * self.cell_height;
        switch (cursor.style) {
            .line => self.fillRectAlpha(x, y, @min(2, self.cell_width), self.cell_height, cursor.color, 255),
            .underline => self.fillRectAlpha(x, y + self.cell_height - @min(2, self.cell_height), self.cell_width, @min(2, self.cell_height), cursor.color, 255),
            .block, .default => self.fillRectAlpha(x, y, self.cell_width, self.cell_height, cursor.color, 112),
        }
    }

    fn blendPixel(self: *RasterViewport, x: i32, y: i32, color: buf.RGBA, alpha: u8) void {
        if (x < 0 or y < 0 or x >= self.width or y >= self.height) return;
        const index: usize = @intCast((@as(u32, @intCast(y)) * self.width + @as(u32, @intCast(x))) * 4);
        const source_alpha = (@as(u32, ansi.alpha(color)) * alpha + 127) / 255;
        const inverse = 255 - source_alpha;
        self.pixels[index] = @intCast((@as(u32, ansi.red(color)) * source_alpha + @as(u32, self.pixels[index]) * inverse + 127) / 255);
        self.pixels[index + 1] = @intCast((@as(u32, ansi.green(color)) * source_alpha + @as(u32, self.pixels[index + 1]) * inverse + 127) / 255);
        self.pixels[index + 2] = @intCast((@as(u32, ansi.blue(color)) * source_alpha + @as(u32, self.pixels[index + 2]) * inverse + 127) / 255);
        self.pixels[index + 3] = 255;
    }

    fn writePixel(self: *RasterViewport, index: usize, color: buf.RGBA) void {
        const base = index * 4;
        self.pixels[base] = ansi.red(color);
        self.pixels[base + 1] = ansi.green(color);
        self.pixels[base + 2] = ansi.blue(color);
        self.pixels[base + 3] = 255;
    }
};
