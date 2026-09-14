const std = @import("std");
const handles = @import("../handles.zig");

test "handles insert and resolve" {
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);
    try std.testing.expect(handle != 0);

    const resolved = handles.resolve(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    try std.testing.expectEqual(@as(*u32, &value), resolved);

    const token = handles.beginDestroy(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(token.handle);
}

test "handles reject wrong kind and zero" {
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);

    try std.testing.expect(handles.resolve(handle, .optimized_buffer, u32) == null);
    try std.testing.expect(handles.resolve(0, .renderer, u32) == null);

    const token = handles.beginDestroy(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(token.handle);
}

test "handles double destroy is rejected" {
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);

    const token = handles.beginDestroy(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(token.handle);

    try std.testing.expect(handles.beginDestroy(handle, .renderer, u32) == null);
}

test "handles reject stale generation after reuse" {
    var first: u32 = 1;
    var second: u32 = 2;

    const stale = try handles.insert(.renderer, &first);
    const token = handles.beginDestroy(stale, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(token.handle);

    const fresh = try handles.insert(.renderer, &second);
    try std.testing.expect(stale != fresh);
    try std.testing.expect(handles.resolve(stale, .renderer, u32) == null);
    try std.testing.expectEqual(@as(*u32, &second), handles.resolve(fresh, .renderer, u32).?);

    const fresh_token = handles.beginDestroy(fresh, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(fresh_token.handle);
}

test "handles reject stale generation after wrap" {
    var value: u32 = 42;
    const stale = try handles.insert(.renderer, &value);
    var current = stale;

    var i: usize = 0;
    while (i < 4095) : (i += 1) {
        const token = handles.beginDestroy(current, .renderer, u32) orelse return error.TestUnexpectedResult;
        handles.finishDestroy(token.handle);
        current = try handles.insert(.renderer, &value);
    }

    try std.testing.expect(handles.resolve(stale, .renderer, u32) == null);

    const token = handles.beginDestroy(current, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(token.handle);
}

test "handles mark destroying before destructor body" {
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);

    const token = handles.beginDestroy(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    try std.testing.expect(handles.resolve(handle, .renderer, u32) == null);
    handles.finishDestroy(token.handle);
}

test "handles pause and unpause temporarily reject calls" {
    var value: u32 = 42;
    const handle = try handles.insert(.renderer, &value);

    const token = handles.pause(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    try std.testing.expect(handles.resolve(handle, .renderer, u32) == null);
    handles.unpause(token.handle);
    try std.testing.expect(handles.resolve(handle, .renderer, u32) != null);

    const destroy_token = handles.beginDestroy(handle, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(destroy_token.handle);
}

test "borrowed handles are stable and invalidated with owner" {
    var owner_value: u32 = 1;
    var child_value: u32 = 2;
    const owner = try handles.insert(.renderer, &owner_value);
    const child_a = try handles.getOrInsertBorrowed(.optimized_buffer, &child_value, owner);
    const child_b = try handles.getOrInsertBorrowed(.optimized_buffer, &child_value, owner);
    try std.testing.expectEqual(child_a, child_b);
    try std.testing.expect(handles.isValid(child_a, .optimized_buffer));
    try std.testing.expect(!handles.isOwned(child_a, .optimized_buffer));

    handles.invalidateChildren(owner);
    try std.testing.expect(!handles.isValid(child_a, .optimized_buffer));

    const token = handles.beginDestroy(owner, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.finishDestroy(token.handle);
}

test "children can be invalidated after owner destroy begins" {
    var owner_value: u32 = 1;
    var child_value: u32 = 2;
    const owner = try handles.insert(.renderer, &owner_value);
    const child = try handles.insertBorrowed(.optimized_buffer, &child_value, owner);

    const token = handles.beginDestroy(owner, .renderer, u32) orelse return error.TestUnexpectedResult;
    handles.invalidateChildren(token.handle);

    try std.testing.expect(!handles.isValid(child, .optimized_buffer));

    handles.finishDestroy(token.handle);
}

test "saturation retires the index — the pool's finite-lifetime cost" {
    var value: u32 = 42;
    var current = try handles.insert(.renderer, &value);

    // Churn one index (LIFO reuse keeps every cycle on the same one) until its
    // 12-bit generation counter saturates. The starting generation depends on
    // which free index this test receives, so saturation is DETECTED — the
    // round whose destroy does not push the index back — not counted.
    var rounds: usize = 0;
    while (rounds <= 4096) : (rounds += 1) {
        const free_before = handles.freeIndexCount();
        const token = handles.beginDestroy(current, .renderer, u32) orelse return error.TestUnexpectedResult;
        handles.finishDestroy(token.handle);

        if (handles.freeIndexCount() == free_before) {
            // 4095 + 1 does not fit the 12-bit field: the index is retired, not
            // pushed back — the table permanently loses one of its 65_535 slots.
            // This is the deliberate price of "a stale handle never resolves".
            try std.testing.expect(handles.resolve(current, .renderer, u32) == null);

            // The next insert must draw a different index; the retired one
            // never returns.
            const fresh = try handles.insert(.renderer, &value);
            try std.testing.expect((fresh & 0xFFFF) != (current & 0xFFFF));
            const fresh_token = handles.beginDestroy(fresh, .renderer, u32) orelse return error.TestUnexpectedResult;
            handles.finishDestroy(fresh_token.handle);
            return;
        }

        current = try handles.insert(.renderer, &value);
    }
    return error.TestUnexpectedResult;
}
