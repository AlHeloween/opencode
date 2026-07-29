const std = @import("std");
const ansi = @import("ansi.zig");
const buf = @import("buffer.zig");
const gp = @import("grapheme.zig");
const link = @import("link.zig");
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
                    try self.paintGrapheme(pool, cell.char, glyph_x, baseline, @intCast((gp.charRightExtent(cell.char) + 1) * cell_width), dimmed_foreground, bold, italic);
                    self.drawDecorations(glyph_x, glyph_y, cell_width, cell_height, baseline, dimmed_foreground, attributes);
                    continue;
                }
                _ = try self.paintCodepoint(cell.char, glyph_x, baseline, dimmed_foreground, bold, italic);
                self.drawDecorations(glyph_x, glyph_y, cell_width, cell_height, baseline, dimmed_foreground, attributes);
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
                const italic_offset: i32 = if (context.italic) @intCast((glyph.height - y) / 4) else 0;
                const pixel_x = dst_x + @as(i32, @intCast(x)) + italic_offset;
                const pixel_y = dst_y + @as(i32, @intCast(y));
                context.viewport.blendPixel(pixel_x, pixel_y, context.color, alpha);
                if (context.bold) context.viewport.blendPixel(pixel_x + 1, pixel_y, context.color, alpha);
            }
        }
    }

    fn paintCodepoint(self: *RasterViewport, codepoint: u32, x: i32, baseline: i32, color: buf.RGBA, bold: bool, italic: bool) !?i32 {
        return self.font.withGlyph(codepoint, .{
            .viewport = self,
            .x = x,
            .baseline = baseline,
            .color = color,
            .bold = bold,
            .italic = italic,
        }, paintGlyph);
    }

    fn paintGrapheme(self: *RasterViewport, pool: *gp.GraphemePool, encoded: u32, x: i32, baseline: i32, cell_span: i32, color: buf.RGBA, bold: bool, italic: bool) !void {
        const bytes = pool.get(gp.graphemeIdFromChar(encoded)) catch |err| {
            logger.warn("bug: raster viewport could not resolve grapheme pool entry: {}", .{err});
            return;
        };
        var offset: usize = 0;
        var pen_x = x;
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
            if (try self.paintCodepoint(codepoint, pen_x, baseline, color, bold, italic)) |advance_x| {
                if (advance_x > 0) pen_x = @min(x + cell_span, pen_x + advance_x);
            }
            offset += sequence_len;
        }
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
