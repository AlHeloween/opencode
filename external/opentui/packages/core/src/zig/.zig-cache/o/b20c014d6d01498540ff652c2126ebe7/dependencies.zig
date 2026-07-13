pub const packages = struct {
    pub const @"N-V-__8AAOYl0gAU76B1VRPFD9AWvy2VkOef2jN0B3sISTeO" = struct {
        pub const build_root = "C:\\Users\\Alexander\\AppData\\Local\\zig\\p\\N-V-__8AAOYl0gAU76B1VRPFD9AWvy2VkOef2jN0B3sISTeO";
        pub const deps: []const struct { []const u8, []const u8 } = &.{};
    };
    pub const @"uucode-0.1.0-ZZjBPtA_TQCWp5PIKmfm5tu1WOkKWFmBGFEMxircPfkA" = struct {
        pub const build_root = "C:\\Users\\Alexander\\AppData\\Local\\zig\\p\\uucode-0.1.0-ZZjBPtA_TQCWp5PIKmfm5tu1WOkKWFmBGFEMxircPfkA";
        pub const build_zig = @import("uucode-0.1.0-ZZjBPtA_TQCWp5PIKmfm5tu1WOkKWFmBGFEMxircPfkA");
        pub const deps: []const struct { []const u8, []const u8 } = &.{
        };
    };
};

pub const root_deps: []const struct { []const u8, []const u8 } = &.{
    .{ "uucode", "uucode-0.1.0-ZZjBPtA_TQCWp5PIKmfm5tu1WOkKWFmBGFEMxircPfkA" },
    .{ "yoga", "N-V-__8AAOYl0gAU76B1VRPFD9AWvy2VkOef2jN0B3sISTeO" },
};
