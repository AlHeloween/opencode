const std = @import("std");
const builtin = @import("builtin");

pub fn main() !void {
    std.debug.print("Hello from Zig scripting!\n", .{});
    std.debug.print("Zig version: {}\n", .{builtin.zig_version});
    std.debug.print("OS: {s}\n", .{@tagName(builtin.os.tag)});

    // Show we can do real work — list current directory
    var dir = try std.fs.cwd().openDir(".", .{ .iterate = true });
    var iter = dir.iterate();
    var count: u32 = 0;
    while (try iter.next()) |entry| {
        count += 1;
        if (count > 5) {
            std.debug.print("  ... and {d} more files\n", .{count});
            break;
        }
        std.debug.print("  - {s}\n", .{entry.name});
    }
}
