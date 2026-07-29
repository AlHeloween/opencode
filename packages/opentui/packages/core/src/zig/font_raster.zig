const std = @import("std");
const freetype = @import("freetype");

pub const bundled_font = @embedFile("assets/JetBrainsMono-Regular.ttf");

pub const Error = error{
    InvalidPixelSize,
    FontSize,
};

/// FreeType-backed, deterministic glyph source for raster-viewport mode.
/// Faces are tried in order (primary first). Missing codepoints fall through
/// the chain; the caller paints a tofu box when every face fails.
pub const FontRasterizer = struct {
    pub const Glyph = struct {
        data: []const u8,
        width: usize,
        height: usize,
        stride: usize,
        left: i32,
        top: i32,
        advance_x: i32,
    };

    const FaceSlot = struct {
        face: freetype.Face,
        pixel_height: u32 = 0,
    };

    const MAX_CACHED_GLYPHS = 4096;
    const MAX_FACES = 4;

    allocator: std.mem.Allocator,
    library: freetype.Library,
    faces: [MAX_FACES]FaceSlot = undefined,
    face_count: usize = 0,
    pixel_height: u32 = 0,
    glyph_cache: std.AutoHashMapUnmanaged(u64, Glyph) = .{},

    pub fn init(allocator: std.mem.Allocator) !FontRasterizer {
        const library = try freetype.Library.init();
        errdefer library.deinit();
        var self: FontRasterizer = .{
            .allocator = allocator,
            .library = library,
        };
        try self.addMemoryFace(bundled_font);
        return self;
    }

    /// Register an additional face after the primary. Later faces are fallbacks.
    pub fn addMemoryFace(self: *FontRasterizer, font_bytes: []const u8) !void {
        if (self.face_count >= MAX_FACES) return error.OutOfMemory;
        const face = try self.library.initMemoryFace(font_bytes, 0);
        self.faces[self.face_count] = .{ .face = face };
        self.face_count += 1;
        if (self.pixel_height > 0) {
            if (freetype.c.FT_Set_Pixel_Sizes(face.handle, 0, self.pixel_height) != 0) return error.FontSize;
            self.faces[self.face_count - 1].pixel_height = self.pixel_height;
        }
    }

    pub fn deinit(self: *FontRasterizer) void {
        var values = self.glyph_cache.valueIterator();
        while (values.next()) |glyph| if (glyph.data.len > 0) self.allocator.free(glyph.data);
        self.glyph_cache.deinit(self.allocator);
        var i: usize = 0;
        while (i < self.face_count) : (i += 1) self.faces[i].face.deinit();
        self.library.deinit();
    }

    pub fn setPixelHeight(self: *FontRasterizer, pixel_height: u32) Error!void {
        if (pixel_height == 0) return error.InvalidPixelSize;
        if (self.pixel_height == pixel_height) return;
        var i: usize = 0;
        while (i < self.face_count) : (i += 1) {
            if (freetype.c.FT_Set_Pixel_Sizes(self.faces[i].face.handle, 0, pixel_height) != 0) return error.FontSize;
            self.faces[i].pixel_height = pixel_height;
        }
        self.pixel_height = pixel_height;
        // Size change invalidates cached bitmaps.
        var values = self.glyph_cache.valueIterator();
        while (values.next()) |glyph| if (glyph.data.len > 0) self.allocator.free(glyph.data);
        self.glyph_cache.clearRetainingCapacity();
    }

    /// Calls `paint` with a monochrome-alpha bitmap and its baseline-relative
    /// placement when any face in the chain can rasterize `codepoint`.
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

        var face_index: usize = 0;
        while (face_index < self.face_count) : (face_index += 1) {
            const face = self.faces[face_index].face;
            const glyph_index = face.getCharIndex(codepoint) orelse continue;
            try face.loadGlyph(glyph_index, .{ .render = true });
            const slot = face.handle.*.glyph.*;
            const bitmap = slot.bitmap;
            const advance_x: i32 = @intCast(slot.advance.x >> 6);
            if (bitmap.buffer == null or bitmap.width == 0 or bitmap.rows == 0) {
                // Space / control with advance only.
                const empty = Glyph{
                    .data = &.{},
                    .width = 0,
                    .height = 0,
                    .stride = 0,
                    .left = 0,
                    .top = 0,
                    .advance_x = advance_x,
                };
                try self.cacheGlyph(cache_key, empty);
                return advance_x;
            }
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
        return null;
    }

    fn cacheGlyph(self: *FontRasterizer, cache_key: u64, glyph: Glyph) !void {
        if (self.glyph_cache.count() >= MAX_CACHED_GLYPHS) return;
        const cached = Glyph{
            .data = if (glyph.data.len > 0) try self.allocator.dupe(u8, glyph.data) else &.{},
            .width = glyph.width,
            .height = glyph.height,
            .stride = glyph.stride,
            .left = glyph.left,
            .top = glyph.top,
            .advance_x = glyph.advance_x,
        };
        errdefer if (cached.data.len > 0) self.allocator.free(cached.data);
        try self.glyph_cache.put(self.allocator, cache_key, cached);
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

test "font chain reports null for missing codepoint" {
    var rasterizer = try FontRasterizer.init(std.testing.allocator);
    defer rasterizer.deinit();
    try rasterizer.setPixelHeight(16);
    // Private-use area is not in JetBrains Mono; chain exhausts to null.
    try std.testing.expect((try rasterizer.withGlyph(0xF8FF, {}, struct {
        fn paint(_: void, _: anytype) void {}
    }.paint)) == null);
}
