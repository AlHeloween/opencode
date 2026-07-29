const std = @import("std");
const freetype = @import("freetype");

pub const bundled_font = @embedFile("assets/JetBrainsMono-Regular.ttf");

pub const Error = error{
    InvalidPixelSize,
    FontSize,
};

/// FreeType-backed, deterministic glyph source for raster-viewport mode.
/// Glyph bitmaps are consumed synchronously while FreeType owns the glyph slot.
pub const FontRasterizer = struct {
    library: freetype.Library,
    face: freetype.Face,

    pub fn init() !FontRasterizer {
        const library = try freetype.Library.init();
        errdefer library.deinit();
        const face = try library.initMemoryFace(bundled_font, 0);
        return .{
            .library = library,
            .face = face,
        };
    }

    pub fn deinit(self: *FontRasterizer) void {
        self.face.deinit();
        self.library.deinit();
    }

    pub fn setPixelHeight(self: *FontRasterizer, pixel_height: u32) Error!void {
        if (pixel_height == 0) return error.InvalidPixelSize;
        if (freetype.c.FT_Set_Pixel_Sizes(self.face.handle, 0, pixel_height) != 0) return error.FontSize;
    }

    /// Calls `paint` with a monochrome-alpha bitmap and its baseline-relative
    /// placement. The bitmap lifetime ends at the next FreeType glyph load.
    pub fn withGlyph(
        self: *FontRasterizer,
        codepoint: u32,
        context: anytype,
        paint: anytype,
    ) !bool {
        const glyph_index = self.face.getCharIndex(codepoint) orelse return false;
        try self.face.loadGlyph(glyph_index, .{ .render = true });
        const glyph = self.face.handle.*.glyph.*;
        const bitmap = glyph.bitmap;
        if (bitmap.buffer == null or bitmap.width == 0 or bitmap.rows == 0) return true;
        const pitch = @as(i32, bitmap.pitch);
        if (pitch <= 0) return false;
        const width: usize = @intCast(bitmap.width);
        const height: usize = @intCast(bitmap.rows);
        const stride: usize = @intCast(pitch);
        const data = bitmap.buffer.?[0 .. stride * height];
        paint(context, .{
            .data = data,
            .width = width,
            .height = height,
            .stride = stride,
            .left = glyph.bitmap_left,
            .top = glyph.bitmap_top,
            .advance_x = glyph.advance.x >> 6,
        });
        return true;
    }
};

test "bundled raster font exposes glyph alpha" {
    var rasterizer = try FontRasterizer.init();
    defer rasterizer.deinit();
    try rasterizer.setPixelHeight(16);
    try std.testing.expect(try rasterizer.withGlyph('A', {}, struct {
        fn paint(_: void, bitmap: anytype) void {
            std.debug.assert(bitmap.width > 0 and bitmap.height > 0 and bitmap.data.len > 0);
        }
    }.paint));
}
