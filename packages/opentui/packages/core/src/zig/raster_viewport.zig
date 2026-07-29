const std = @import("std");
const ansi = @import("ansi.zig");
const buf = @import("buffer.zig");
const gp = @import("grapheme.zig");
const link = @import("link.zig");
const FontRasterizer = @import("font_raster.zig").FontRasterizer;
const Terminal = @import("terminal.zig");
const logger = @import("logger.zig");

/// Zero-width / non-spacing marks that must not advance the pen in a cluster.
fn isNonSpacing(codepoint: u32) bool {
    return switch (codepoint) {
        0x200B...0x200F => true, // ZWSP, ZWNJ, ZWJ, LRM, RLM
        0xFE00...0xFE0F => true, // variation selectors
        0x0300...0x036F => true, // combining diacriticals
        0x20D0...0x20FF => true,
        0x1AB0...0x1AFF => true,
        0x1DC0...0x1DFF => true,
        else => false,
    };
}

/// Geometric fill for common UI block / box-drawing codepoints so borders and
/// scrollbars stay crisp without depending on FreeType coverage.
fn tryGeometricFill(
    self: *RasterViewport,
    codepoint: u32,
    x: i32,
    y: u32,
    cell_w: u32,
    cell_h: u32,
    color: buf.RGBA,
) bool {
    const ox: u32 = if (x < 0) 0 else @intCast(x);
    const half_w = cell_w / 2;
    const half_h = cell_h / 2;
    const line_h = @max(1, cell_h / 8);
    const line_w = @max(1, cell_w / 8);
    switch (codepoint) {
        0x2588 => { // FULL BLOCK
            self.fillRect(ox, y, cell_w, cell_h, color);
            return true;
        },
        0x2580 => { // UPPER HALF BLOCK
            self.fillRect(ox, y, cell_w, half_h, color);
            return true;
        },
        0x2584 => { // LOWER HALF BLOCK
            self.fillRect(ox, y + half_h, cell_w, cell_h - half_h, color);
            return true;
        },
        0x258C => { // LEFT HALF BLOCK
            self.fillRect(ox, y, half_w, cell_h, color);
            return true;
        },
        0x2590 => { // RIGHT HALF BLOCK
            self.fillRect(ox + half_w, y, cell_w - half_w, cell_h, color);
            return true;
        },
        0x2591 => { // LIGHT SHADE
            self.fillRectAlpha(ox, y, cell_w, cell_h, color, 64);
            return true;
        },
        0x2592 => {
            self.fillRectAlpha(ox, y, cell_w, cell_h, color, 128);
            return true;
        },
        0x2593 => {
            self.fillRectAlpha(ox, y, cell_w, cell_h, color, 192);
            return true;
        },
        0x2500, 0x2501 => { // horizontal
            self.fillRect(ox, y + half_h, cell_w, line_h, color);
            return true;
        },
        0x2502, 0x2503 => { // vertical
            self.fillRect(ox + half_w, y, line_w, cell_h, color);
            return true;
        },
        0x250C => { // top-left corner
            self.fillRect(ox + half_w, y + half_h, cell_w - half_w, line_h, color);
            self.fillRect(ox + half_w, y + half_h, line_w, cell_h - half_h, color);
            return true;
        },
        0x2510 => { // top-right
            self.fillRect(ox, y + half_h, half_w + 1, line_h, color);
            self.fillRect(ox + half_w, y + half_h, line_w, cell_h - half_h, color);
            return true;
        },
        0x2514 => { // bottom-left
            self.fillRect(ox + half_w, y + half_h, cell_w - half_w, line_h, color);
            self.fillRect(ox + half_w, y, line_w, half_h + 1, color);
            return true;
        },
        0x2518 => { // bottom-right
            self.fillRect(ox, y + half_h, half_w + 1, line_h, color);
            self.fillRect(ox + half_w, y, line_w, half_h + 1, color);
            return true;
        },
        0x252C => { // T down
            self.fillRect(ox, y + half_h, cell_w, line_h, color);
            self.fillRect(ox + half_w, y + half_h, line_w, cell_h - half_h, color);
            return true;
        },
        0x2534 => { // T up
            self.fillRect(ox, y + half_h, cell_w, line_h, color);
            self.fillRect(ox + half_w, y, line_w, half_h + 1, color);
            return true;
        },
        0x251C => { // T right
            self.fillRect(ox + half_w, y, line_w, cell_h, color);
            self.fillRect(ox + half_w, y + half_h, cell_w - half_w, line_h, color);
            return true;
        },
        0x2524 => { // T left
            self.fillRect(ox + half_w, y, line_w, cell_h, color);
            self.fillRect(ox, y + half_h, half_w + 1, line_h, color);
            return true;
        },
        0x253C => { // cross
            self.fillRect(ox, y + half_h, cell_w, line_h, color);
            self.fillRect(ox + half_w, y, line_w, cell_h, color);
            return true;
        },
        else => return false,
    }
}

fn drawTofu(self: *RasterViewport, x: i32, y: u32, cell_w: u32, cell_h: u32, color: buf.RGBA) void {
    if (cell_w < 3 or cell_h < 3) {
        self.fillRectAlpha(@intCast(x), y, cell_w, cell_h, color, 180);
        return;
    }
    const inset_x: u32 = 1;
    const inset_y: u32 = 1;
    const ox: u32 = @intCast(x);
    // Hollow rectangle so missing glyphs stay visible without looking like a full block.
    self.fillRect(ox + inset_x, y + inset_y, cell_w - 2 * inset_x, 1, color);
    self.fillRect(ox + inset_x, y + cell_h - inset_y - 1, cell_w - 2 * inset_x, 1, color);
    self.fillRect(ox + inset_x, y + inset_y, 1, cell_h - 2 * inset_y, color);
    self.fillRect(ox + cell_w - inset_x - 1, y + inset_y, 1, cell_h - 2 * inset_y, color);
}

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
        return .{ .allocator = allocator, .font = try FontRasterizer.init(allocator) };
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

        // One joint pass: background → media (row-sliced into the cell grid) →
        // glyphs/geometry → caret. Media is not a post-frame plane; it samples
        // the same cell coordinates as text so scroll/reflow stay coherent.
        self.fill(background);
        for (0..cells.height) |y| {
            for (0..cells.width) |x| {
                const cell = cells.get(@intCast(x), @intCast(y)) orelse continue;
                const attributes = ansi.TextAttributes.getBaseAttributes(cell.attributes);
                const inverse = attributes & ansi.TextAttributes.INVERSE != 0;
                const cell_background = if (inverse) cell.fg else cell.bg;
                const foreground = if (inverse) cell.bg else cell.fg;
                const glyph_x: i32 = @intCast(x * cell_width);
                const glyph_y: u32 = @intCast(y * cell_height);
                const baseline: i32 = @intCast((y + 1) * cell_height - 2);
                self.fillRect(@intCast(x * cell_width), glyph_y, cell_width, cell_height, cell_background);
                // Media occupancy mask: any patch covering this cell paints its
                // row/col strip with source alpha (transparent → keep bg).
                self.paintMediaCell(media, @intCast(x), @intCast(y));
                if (gp.isContinuationChar(cell.char)) continue;
                if (attributes & ansi.TextAttributes.HIDDEN != 0) continue;
                const dimmed_foreground = if (attributes & ansi.TextAttributes.DIM != 0) self.dim(foreground) else foreground;
                const bold = attributes & ansi.TextAttributes.BOLD != 0;
                const italic = attributes & ansi.TextAttributes.ITALIC != 0;
                if (cell.char == buf.DEFAULT_SPACE_CHAR) {
                    self.drawDecorations(glyph_x, glyph_y, cell_width, cell_height, baseline, dimmed_foreground, attributes);
                    continue;
                }
                if (gp.isGraphemeChar(cell.char)) {
                    const span_cells = gp.charRightExtent(cell.char) + 1;
                    try self.paintGrapheme(pool, cell.char, glyph_x, baseline, @intCast(span_cells * cell_width), glyph_y, dimmed_foreground, bold, italic);
                    self.drawDecorations(glyph_x, glyph_y, span_cells * cell_width, cell_height, baseline, dimmed_foreground, attributes);
                    continue;
                }
                try self.paintCodepoint(cell.char, glyph_x, baseline, glyph_y, cell_width, dimmed_foreground, bold, italic);
                self.drawDecorations(glyph_x, glyph_y, cell_width, cell_height, baseline, dimmed_foreground, attributes);
            }
        }
        self.drawCursor(cursor);
        return self.pixels;
    }

    /// Paint the portion of every media patch that covers cell `(cx, cy)`.
    /// Source RGBA is scaled into the reserved cell box so one diagram row
    /// aligns with one text row (`cell_height` destination pixels).
    fn paintMediaCell(self: *RasterViewport, media: *const buf.PixelBuffer, cx: u32, cy: u32) void {
        for (media.patches.items) |patch| {
            const cell_w = if (patch.cell_w > 0) patch.cell_w else 1;
            const cell_h = if (patch.cell_h > 0) patch.cell_h else 1;
            if (patch.width == 0 or patch.height == 0) continue;
            if (cx < patch.x or cy < patch.y) continue;
            if (cx >= patch.x + cell_w or cy >= patch.y + cell_h) continue;

            const local_c = cx - patch.x;
            const local_r = cy - patch.y;
            const dest_x = cx * self.cell_width;
            const dest_y = cy * self.cell_height;
            // Full scaled footprint of the patch in viewport pixels.
            const scale_w = cell_w * self.cell_width;
            const scale_h = cell_h * self.cell_height;
            if (scale_w == 0 or scale_h == 0) continue;

            var py: u32 = 0;
            while (py < self.cell_height) : (py += 1) {
                // Map this cell-local pixel into the full scaled image, then into source.
                const scaled_y = local_r * self.cell_height + py;
                const src_y = @min(patch.height - 1, (scaled_y * patch.height) / scale_h);
                var px: u32 = 0;
                while (px < self.cell_width) : (px += 1) {
                    const scaled_x = local_c * self.cell_width + px;
                    const src_x = @min(patch.width - 1, (scaled_x * patch.width) / scale_w);
                    const source = (@as(usize, src_y) * patch.width + src_x) * 4;
                    if (source + 3 >= patch.data.len) continue;
                    const alpha = patch.data[source + 3];
                    if (alpha == 0) continue; // mask: leave cell background / prior layers
                    self.blendPixel(
                        @intCast(dest_x + px),
                        @intCast(dest_y + py),
                        .{ patch.data[source], patch.data[source + 1], patch.data[source + 2], 255 },
                        alpha,
                    );
                }
            }
        }
    }

    fn paintGlyph(context: anytype, glyph: anytype) void {
        const dst_x = context.x + glyph.left;
        const dst_y = context.baseline - glyph.top;
        for (0..glyph.height) |y| {
            for (0..glyph.width) |x| {
                const alpha = glyph.data[y * glyph.stride + x];
                if (alpha == 0) continue;
                const italic_offset: i32 = if (context.italic) @intCast((glyph.height - y) / 4) else 0;
                const pixel_x = dst_x + @as(i32, @intCast(x)) + italic_offset;
                const pixel_y = dst_y + @as(i32, @intCast(y));
                context.viewport.blendPixel(pixel_x, pixel_y, context.color, alpha);
                if (context.bold) context.viewport.blendPixel(pixel_x + 1, pixel_y, context.color, alpha);
            }
        }
    }

    fn paintCodepoint(
        self: *RasterViewport,
        codepoint: u32,
        x: i32,
        baseline: i32,
        cell_y: u32,
        cell_w: u32,
        color: buf.RGBA,
        bold: bool,
        italic: bool,
    ) !void {
        if (tryGeometricFill(self, codepoint, x, cell_y, cell_w, self.cell_height, color)) return;
        if (isNonSpacing(codepoint)) {
            // Overstrike previous advance origin without advancing further.
            _ = try self.font.withGlyph(codepoint, .{
                .viewport = self,
                .x = x,
                .baseline = baseline,
                .color = color,
                .bold = bold,
                .italic = italic,
            }, paintGlyph);
            return;
        }
        const advance = try self.font.withGlyph(codepoint, .{
            .viewport = self,
            .x = x,
            .baseline = baseline,
            .color = color,
            .bold = bold,
            .italic = italic,
        }, paintGlyph);
        if (advance == null) {
            drawTofu(self, x, cell_y, cell_w, self.cell_height, color);
        }
    }

    fn paintGrapheme(
        self: *RasterViewport,
        pool: *gp.GraphemePool,
        encoded: u32,
        x: i32,
        baseline: i32,
        cell_span: i32,
        cell_y: u32,
        color: buf.RGBA,
        bold: bool,
        italic: bool,
    ) !void {
        const bytes = pool.get(gp.graphemeIdFromChar(encoded)) catch |err| {
            logger.warn("bug: raster viewport could not resolve grapheme pool entry: {}", .{err});
            drawTofu(self, x, cell_y, @intCast(@max(1, cell_span)), self.cell_height, color);
            return;
        };
        var offset: usize = 0;
        var pen_x = x;
        var painted_any = false;
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
            offset += sequence_len;
            if (isNonSpacing(codepoint)) {
                if (tryGeometricFill(self, codepoint, pen_x, cell_y, self.cell_width, self.cell_height, color)) {
                    painted_any = true;
                    continue;
                }
                _ = try self.font.withGlyph(codepoint, .{
                    .viewport = self,
                    .x = pen_x,
                    .baseline = baseline,
                    .color = color,
                    .bold = bold,
                    .italic = italic,
                }, paintGlyph);
                continue;
            }
            if (tryGeometricFill(self, codepoint, pen_x, cell_y, self.cell_width, self.cell_height, color)) {
                painted_any = true;
                pen_x = @min(x + cell_span, pen_x + @as(i32, @intCast(self.cell_width)));
                continue;
            }
            if (try self.font.withGlyph(codepoint, .{
                .viewport = self,
                .x = pen_x,
                .baseline = baseline,
                .color = color,
                .bold = bold,
                .italic = italic,
            }, paintGlyph)) |advance_x| {
                painted_any = true;
                if (advance_x > 0) pen_x = @min(x + cell_span, pen_x + advance_x);
            } else {
                drawTofu(self, pen_x, cell_y, self.cell_width, self.cell_height, color);
                painted_any = true;
                pen_x = @min(x + cell_span, pen_x + @as(i32, @intCast(self.cell_width)));
            }
        }
        if (!painted_any) drawTofu(self, x, cell_y, @intCast(@max(1, cell_span)), self.cell_height, color);
    }

    fn drawDecorations(self: *RasterViewport, x: i32, y: u32, width: u32, height: u32, baseline: i32, color: buf.RGBA, attributes: u8) void {
        const underline_y: u32 = @intCast(@max(@as(i32, @intCast(y)), baseline + 1));
        if (attributes & ansi.TextAttributes.UNDERLINE != 0) self.fillRectAlpha(@intCast(x), underline_y, width, 1, color, 255);
        if (attributes & ansi.TextAttributes.STRIKETHROUGH != 0) self.fillRectAlpha(@intCast(x), y + height / 2, width, 1, color, 255);
    }

    fn dim(self: *const RasterViewport, color: buf.RGBA) buf.RGBA {
        _ = self;
        return ansi.rgbColor(ansi.red(color) / 2, ansi.green(color) / 2, ansi.blue(color) / 2, ansi.alpha(color));
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

fn pixelAt(pixels: []const u8, width: u32, x: u32, y: u32) []const u8 {
    const index = (y * width + x) * 4;
    return pixels[index .. index + 4];
}

test "raster viewport composes cells, media, and caret into one RGBA frame" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    const cells = try buf.OptimizedBuffer.init(std.testing.allocator, 2, 2, .{
        .pool = pool,
        .link_pool = &local_link_pool,
    });
    defer cells.deinit();
    const media = try buf.PixelBuffer.init(std.testing.allocator);
    defer media.deinit();
    var viewport = try RasterViewport.init(std.testing.allocator);
    defer viewport.deinit();

    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    const blue = ansi.rgbColor(0, 0, 255, 255);
    const yellow = ansi.rgbColor(255, 255, 0, 255);
    const green = ansi.rgbColor(0, 255, 0, 255);
    cells.clear(black, null);
    cells.set(0, 0, .{ .char = 'A', .fg = white, .bg = black, .attributes = 0 });
    cells.set(1, 0, .{ .char = 'B', .fg = blue, .bg = yellow, .attributes = ansi.TextAttributes.INVERSE });
    const red_pixel = [_]u8{ 255, 0, 0, 255 };
    media.drawImage(0, 1, 1, 1, &red_pixel, 1, 1);

    const pixels = try viewport.render(cells, media, pool, 8, 16, black, .{
        .x = 2,
        .y = 2,
        .visible = true,
        .style = .line,
        .color = green,
    });
    try std.testing.expectEqual(@as(usize, 2 * 8 * 2 * 16 * 4), pixels.len);
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 255, 255 }, pixels[(8 * 4)..(9 * 4)]);
    const media_pixel = ((16 * 16) + 0) * 4;
    try std.testing.expectEqualSlices(u8, &red_pixel, pixels[media_pixel .. media_pixel + 4]);
    const caret_pixel = ((16 * 16) + 8) * 4;
    try std.testing.expectEqualSlices(u8, &.{ 0, 255, 0, 255 }, pixels[caret_pixel .. caret_pixel + 4]);
    try std.testing.expect(std.mem.indexOf(u8, pixels[0 .. 8 * 16 * 4], &.{ 255, 255, 255 }) != null);
}

test "raster viewport paints selection inverse, scrollbar block, and box borders" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    const cells = try buf.OptimizedBuffer.init(std.testing.allocator, 4, 3, .{
        .pool = pool,
        .link_pool = &local_link_pool,
    });
    defer cells.deinit();
    const media = try buf.PixelBuffer.init(std.testing.allocator);
    defer media.deinit();
    var viewport = try RasterViewport.init(std.testing.allocator);
    defer viewport.deinit();

    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    const gray = ansi.rgbColor(128, 128, 128, 255);
    const cyan = ansi.rgbColor(0, 255, 255, 255);
    cells.clear(black, null);
    // Selection: inverse swaps fg/bg → cyan cell background.
    cells.set(0, 0, .{ .char = 'S', .fg = cyan, .bg = black, .attributes = ansi.TextAttributes.INVERSE });
    // Scrollbar track full block.
    cells.set(3, 0, .{ .char = 0x2588, .fg = gray, .bg = black, .attributes = 0 });
    // Horizontal border under the selection.
    cells.set(0, 1, .{ .char = 0x2500, .fg = white, .bg = black, .attributes = 0 });
    cells.set(1, 1, .{ .char = 0x2500, .fg = white, .bg = black, .attributes = 0 });
    // Vertical border on the right of the first column.
    cells.set(0, 2, .{ .char = 0x2502, .fg = white, .bg = black, .attributes = 0 });

    const cell_w: u32 = 6;
    const cell_h: u32 = 10;
    const pixels = try viewport.render(cells, media, pool, cell_w, cell_h, black, .{
        .x = 0,
        .y = 0,
        .visible = false,
        .style = .block,
        .color = white,
    });
    const width = 4 * cell_w;
    // Inverse selection paints cyan background in cell (0,0).
    try std.testing.expectEqualSlices(u8, &.{ 0, 255, 255, 255 }, pixelAt(pixels, width, 0, 0));
    // Full-block scrollbar is solid gray.
    try std.testing.expectEqualSlices(u8, &.{ 128, 128, 128, 255 }, pixelAt(pixels, width, 3 * cell_w + 1, 1));
    // Horizontal rule row is white near the vertical midpoint of cell row 1.
    try std.testing.expectEqualSlices(u8, &.{ 255, 255, 255, 255 }, pixelAt(pixels, width, 1, cell_h + cell_h / 2));
    // Vertical rule is white near the horizontal midpoint of cell (0,2).
    try std.testing.expectEqualSlices(u8, &.{ 255, 255, 255, 255 }, pixelAt(pixels, width, cell_w / 2, 2 * cell_h + 1));
}

test "raster viewport joint-pass media is row-sliced onto the cell grid with alpha mask" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    // 3 cols × 3 rows. Diagram occupies rows 1..2 (two text rows), cols 0..1.
    const cells = try buf.OptimizedBuffer.init(std.testing.allocator, 3, 3, .{
        .pool = pool,
        .link_pool = &local_link_pool,
    });
    defer cells.deinit();
    const media = try buf.PixelBuffer.init(std.testing.allocator);
    defer media.deinit();
    var viewport = try RasterViewport.init(std.testing.allocator);
    defer viewport.deinit();

    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    cells.clear(black, null);
    // Gap cell under transparent media (row 1, col 1): geometric full-block after media.
    cells.set(1, 1, .{ .char = 0x2588, .fg = white, .bg = black, .attributes = 0 });

    // 2×2 source: top-left red, top-right transparent, bottom-left green, bottom-right blue.
    // Mapped into 2×2 cells starting at (0,1).
    const cell_w: u32 = 4;
    const cell_h: u32 = 4;
    const diagram = [_]u8{
        255, 0, 0, 255, // (0,0) red
        0, 0, 0, 0, // (1,0) transparent — full-block glyph must paint over this
        0, 255, 0, 255, // (0,1) green
        0, 0, 255, 255, // (1,1) blue
    };
    media.drawImage(0, 1, 2, 2, &diagram, 2, 2);

    const pixels = try viewport.render(cells, media, pool, cell_w, cell_h, black, .{
        .x = 0,
        .y = 0,
        .visible = false,
        .style = .block,
        .color = white,
    });
    const width = 3 * cell_w;
    // Row 1 = diagram top: cell (0,1) is red (scaled from source 0,0).
    try std.testing.expectEqualSlices(u8, &.{ 255, 0, 0, 255 }, pixelAt(pixels, width, 0, cell_h));
    // Cell (1,1): alpha=0 media → white full-block geometry wins in the joint pass.
    try std.testing.expectEqualSlices(u8, &.{ 255, 255, 255, 255 }, pixelAt(pixels, width, cell_w + 1, cell_h + 1));
    // Row 2 = diagram bottom: cell (0,2) green, (1,2) blue.
    try std.testing.expectEqualSlices(u8, &.{ 0, 255, 0, 255 }, pixelAt(pixels, width, 0, 2 * cell_h));
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 255, 255 }, pixelAt(pixels, width, cell_w, 2 * cell_h));
}

test "raster viewport scroll shift keeps media strips locked to text rows" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    const cells = try buf.OptimizedBuffer.init(std.testing.allocator, 2, 3, .{
        .pool = pool,
        .link_pool = &local_link_pool,
    });
    defer cells.deinit();
    const media = try buf.PixelBuffer.init(std.testing.allocator);
    defer media.deinit();
    var viewport = try RasterViewport.init(std.testing.allocator);
    defer viewport.deinit();

    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    const cell_w: u32 = 4;
    const cell_h: u32 = 4;
    cells.clear(black, null);
    cells.set(0, 0, .{ .char = 'A', .fg = white, .bg = black, .attributes = 0 });
    // Two-row diagram starting at layout row 1 (same as ImageRenderable reservation).
    const diagram = [_]u8{
        255, 0, 0, 255, 255, 0, 0, 255,
        0, 0, 255, 255, 0, 0, 255, 255,
    };
    media.drawImage(0, 1, 2, 2, &diagram, 2, 2);

    const before = try viewport.render(cells, media, pool, cell_w, cell_h, black, .{
        .x = 0,
        .y = 0,
        .visible = false,
        .style = .block,
        .color = white,
    });
    const width = 2 * cell_w;
    // Red strip on text row 1, blue on text row 2.
    try std.testing.expectEqualSlices(u8, &.{ 255, 0, 0, 255 }, pixelAt(before, width, 0, cell_h));
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 255, 255 }, pixelAt(before, width, 0, 2 * cell_h));

    // Simulate scroll: content moves up one row — text 'A' leaves, diagram top moves to row 0.
    cells.clear(black, null);
    media.clear();
    media.drawImage(0, 0, 2, 2, &diagram, 2, 2);
    const after = try viewport.render(cells, media, pool, cell_w, cell_h, black, .{
        .x = 0,
        .y = 0,
        .visible = false,
        .style = .block,
        .color = white,
    });
    try std.testing.expectEqualSlices(u8, &.{ 255, 0, 0, 255 }, pixelAt(after, width, 0, 0));
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 255, 255 }, pixelAt(after, width, 0, cell_h));
}

test "raster viewport draws tofu for missing glyphs" {
    const pool = gp.initGlobalPool(std.testing.allocator);
    defer gp.deinitGlobalPool();
    var local_link_pool = link.LinkPool.init(std.testing.allocator);
    defer local_link_pool.deinit();
    const cells = try buf.OptimizedBuffer.init(std.testing.allocator, 1, 1, .{
        .pool = pool,
        .link_pool = &local_link_pool,
    });
    defer cells.deinit();
    const media = try buf.PixelBuffer.init(std.testing.allocator);
    defer media.deinit();
    var viewport = try RasterViewport.init(std.testing.allocator);
    defer viewport.deinit();

    const black = ansi.rgbColor(0, 0, 0, 255);
    const white = ansi.rgbColor(255, 255, 255, 255);
    cells.clear(black, null);
    cells.set(0, 0, .{ .char = 0xF8FF, .fg = white, .bg = black, .attributes = 0 });

    const pixels = try viewport.render(cells, media, pool, 8, 12, black, .{
        .x = 0,
        .y = 0,
        .visible = false,
        .style = .block,
        .color = white,
    });
    // Tofu is a hollow rect; top edge pixel is white.
    try std.testing.expectEqualSlices(u8, &.{ 255, 255, 255, 255 }, pixelAt(pixels, 8, 1, 1));
    // Interior remains background black.
    try std.testing.expectEqualSlices(u8, &.{ 0, 0, 0, 255 }, pixelAt(pixels, 8, 4, 6));
}
