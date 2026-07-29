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
    const Glyph = struct {
        data: []const u8,
        width: usize,
        height: usize,
        stride: usize,
        left: i32,
        top: i32,
        advance_x: i32,
    };

    const MAX_CACHED_GLYPHS = 4096;

    allocator: std.mem.Allocator,
    library: freetype.Library,
    face: freetype.Face,
    pixel_height: u32 = 0,
    glyph_cache: std.AutoHashMapUnmanaged(u64, Glyph) = .{},

    pub fn init(allocator: std.mem.Allocator) !FontRasterizer {
        const library = try freetype.Library.init();
        errdefer library.deinit();
        const face = try library.initMemoryFace(bundled_font, 0);
        return .{
            .allocator = allocator,
            .library = library,
            .face = face,
        };
    }

    pub fn deinit(self: *FontRasterizer) void {
        var values = self.glyph_cache.valueIterator();
        while (values.next()) |glyph| if (glyph.data.len > 0) self.allocator.free(glyph.data);
        self.glyph_cache.deinit(self.allocator);
        self.face.deinit();
        self.library.deinit();
    }

    pub fn setPixelHeight(self: *FontRasterizer, pixel_height: u32) Error!void {
        if (pixel_height == 0) return error.InvalidPixelSize;
        if (self.pixel_height == pixel_height) return;
        if (freetype.c.FT_Set_Pixel_Sizes(self.face.handle, 0, pixel_height) != 0) return error.FontSize;
        self.pixel_height = pixel_height;
    }

    /// Calls `paint` with a monochrome-alpha bitmap and its baseline-relative
    /// placement. The bitmap lifetime ends at the next FreeType glyph load.
    pub fn withGlyph(
        self: *FontRasterizer,
        codepoint: u32,
        context: anytype,
        paint: anytype,
    ) !?i32 {
        const cache_key = (@as(u64, self.pixel_height) << 32) | codepoint;
        if (self.glyph_cache.get(cache_key)) |glyph| {
            if (glyph.data.len > 0) paint(context, glyph);
            return glyph.advance_x;
        }
        const glyph_index = self.face.getCharIndex(codepoint) orelse return null;
        try self.face.loadGlyph(glyph_index, .{ .render = true });
        const slot = self.face.handle.*.glyph.*;
        const bitmap = slot.bitmap;
        const advance_x: i32 = @intCast(slot.advance.x >> 6);
        if (bitmap.buffer == null or bitmap.width == 0 or bitmap.rows == 0) return advance_x;
        const pitch = @as(i32, bitmap.pitch);
        if (pitch <= 0) return advance_x;
        const width: usize = @intCast(bitmap.width);
        const height: usize = @intCast(bitmap.rows);
        const stride: usize = @intCast(pitch);
        const glyph = Glyph{
            .data = bitmap.buffer[0 .. stride * height],
            .width = width,
            .height = height,
            .stride = stride,
            .left = slot.bitmap_left,
            .top = slot.bitmap_top,
            .advance_x = advance_x,
        };
        if (self.glyph_cache.count() >= MAX_CACHED_GLYPHS) {
            paint(context, glyph);
            return advance_x;
        }
        const cached = Glyph{
            .data = try self.allocator.dupe(u8, glyph.data),
            .width = glyph.width,
            .height = glyph.height,
            .stride = glyph.stride,
            .left = glyph.left,
            .top = glyph.top,
            .advance_x = glyph.advance_x,
        };
        errdefer self.allocator.free(cached.data);
        try self.glyph_cache.put(self.allocator, cache_key, cached);
        paint(context, cached);
        return advance_x;
    }
};

test "bundled raster font exposes glyph alpha" {
    var rasterizer = try FontRasterizer.init(std.testing.allocator);
    defer rasterizer.deinit();
    try rasterizer.setPixelHeight(16);
    try std.testing.expect((try rasterizer.withGlyph('A', {}, struct {
        fn paint(_: void, bitmap: anytype) void {
            std.debug.assert(bitmap.width > 0 and bitmap.height > 0 and bitmap.data.len > 0);
        }
    }.paint)) != null);
    try std.testing.expectEqual(@as(u32, 1), rasterizer.glyph_cache.count());
    try std.testing.expect((try rasterizer.withGlyph('A', {}, struct {
        fn paint(_: void, bitmap: anytype) void {
            std.debug.assert(bitmap.width > 0 and bitmap.height > 0 and bitmap.data.len > 0);
        }
    }.paint)) != null);
    try std.testing.expectEqual(@as(u32, 1), rasterizer.glyph_cache.count());
}
