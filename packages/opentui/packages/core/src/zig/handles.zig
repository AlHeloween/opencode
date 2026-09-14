const std = @import("std");

pub const Handle = u32;

const INDEX_BITS = 16;
const GENERATION_BITS = 12;
const KIND_BITS = 4;
const INDEX_MASK: u32 = (1 << INDEX_BITS) - 1;
const GENERATION_MASK: u32 = (1 << GENERATION_BITS) - 1;
const MAX_SLOTS: usize = INDEX_MASK;

comptime {
    std.debug.assert(INDEX_BITS + GENERATION_BITS + KIND_BITS == 32);
}

pub const ObjectKind = enum(u4) {
    renderer = 0,
    optimized_buffer = 1,
    text_buffer = 2,
    text_buffer_view = 3,
    edit_buffer = 4,
    editor_view = 5,
    syntax_style = 6,
    event_sink = 7,
    audio_engine = 8,
    native_renderable = 9,
    pixel_buffer = 10,
};

const SlotState = enum(u8) {
    vacant,
    alive,
    destroying,
};

const ObjectSlot = struct {
    generation: u32 = 1,
    kind: u8 = 0,
    state: SlotState = .vacant,
    ptr: usize = 0,
    owned: bool = true,
    owner: Handle = 0,
};

pub const Error = error{
    OutOfHandles,
};

pub fn DestroyToken(comptime T: type) type {
    return struct {
        handle: Handle,
        ptr: *T,
    };
}

// Native core entry is serialized by contract. Renderer and audio implementation
// threads synchronize their own private state and do not enter this registry.
var slots: [MAX_SLOTS + 1]ObjectSlot = [_]ObjectSlot{.{}} ** (MAX_SLOTS + 1);
var slot_count: u32 = 1;
var free_indices: [MAX_SLOTS]u16 = undefined;
var free_index_count: usize = 0;

fn encode(index: u32, generation: u32, kind: ObjectKind) Handle {
    return (@as(u32, @intFromEnum(kind)) << (INDEX_BITS + GENERATION_BITS)) |
        ((generation & GENERATION_MASK) << INDEX_BITS) |
        (index & INDEX_MASK);
}

fn slotIndex(handle: Handle) u32 {
    return handle & INDEX_MASK;
}

fn slotGeneration(handle: Handle) u32 {
    return (handle >> INDEX_BITS) & GENERATION_MASK;
}

fn slotKind(handle: Handle) u4 {
    return @intCast(handle >> (INDEX_BITS + GENERATION_BITS));
}

fn nextGeneration(generation: u32) ?u32 {
    const next = generation + 1;
    return if (next > GENERATION_MASK) null else next;
}

fn validateSlot(handle: Handle, expected_kind: ObjectKind) ?u16 {
    if (handle == 0) return null;
    if (slotKind(handle) != @intFromEnum(expected_kind)) return null;

    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slot_count) return null;

    const index: u16 = @intCast(index_u32);
    const slot = &slots[index];
    if (slot.generation != slotGeneration(handle)) return null;
    if (slot.kind != @intFromEnum(expected_kind)) return null;
    if (slot.state != .alive) return null;
    if (slot.ptr == 0) return null;
    return index;
}

/// Returns the index to the free list with its generation advanced. A saturated
/// 12-bit generation RETIRES the index (`nextGeneration` returns null) instead
/// of wrapping the counter back to 1: the wrap reopens a 1-in-4096 window where
/// a stale handle validates against whatever later occupies its index, and that
/// use-after-free guarantee outranks pool longevity (decision 2026-09-14; a
/// wrap variant was implemented and withdrawn for exactly this reason). The
/// deliberate cost: the table has a finite lifetime under unbounded churn, so a
/// long-lived process must bound handle churn rather than trust destroy alone.
fn vacateSlot(index: u16) void {
    const slot = &slots[index];
    slot.ptr = 0;
    slot.owner = 0;
    slot.owned = true;
    slot.kind = 0;
    slot.state = .vacant;

    const next = nextGeneration(slot.generation) orelse return;
    slot.generation = next;
    std.debug.assert(free_index_count < free_indices.len);
    free_indices[free_index_count] = index;
    free_index_count += 1;
}

pub fn insert(kind: ObjectKind, ptr_value: *anyopaque) Error!Handle {
    return insertWithOwner(kind, ptr_value, true, 0);
}

pub fn insertBorrowed(kind: ObjectKind, ptr_value: *anyopaque, owner: Handle) Error!Handle {
    return insertWithOwner(kind, ptr_value, false, owner);
}

pub fn insertOwnedChild(kind: ObjectKind, ptr_value: *anyopaque, owner: Handle) Error!Handle {
    return insertWithOwner(kind, ptr_value, true, owner);
}

pub fn getOrInsertBorrowed(kind: ObjectKind, ptr_value: *anyopaque, owner: Handle) Error!Handle {
    const raw_ptr = @intFromPtr(ptr_value);
    var index: usize = 1;
    while (index < slot_count) : (index += 1) {
        const slot = &slots[index];
        if (slot.state == .alive and slot.kind == @intFromEnum(kind) and slot.ptr == raw_ptr and slot.owner == owner) {
            return encode(@intCast(index), slot.generation, kind);
        }
    }

    return insertWithOwner(kind, ptr_value, false, owner);
}

fn insertWithOwner(kind: ObjectKind, ptr_value: *anyopaque, owned: bool, owner: Handle) Error!Handle {
    const index: u16 = if (free_index_count > 0) blk: {
        free_index_count -= 1;
        break :blk free_indices[free_index_count];
    } else blk: {
        if (slot_count > MAX_SLOTS) return Error.OutOfHandles;
        const new_index: u16 = @intCast(slot_count);
        slot_count += 1;
        break :blk new_index;
    };

    const slot = &slots[index];
    slot.owned = owned;
    slot.owner = owner;
    slot.kind = @intFromEnum(kind);
    slot.ptr = @intFromPtr(ptr_value);
    slot.state = .alive;

    return encode(index, slot.generation, kind);
}

pub fn acquire(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?*T {
    const index = validateSlot(handle, expected_kind) orelse return null;
    const opaque_ptr: *anyopaque = @ptrFromInt(slots[index].ptr);
    return @ptrCast(@alignCast(opaque_ptr));
}

pub fn resolve(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?*T {
    return acquire(handle, expected_kind, T);
}

pub fn beginDestroy(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?DestroyToken(T) {
    const index = validateSlot(handle, expected_kind) orelse return null;
    const slot = &slots[index];
    if (!slot.owned) return null;
    slot.state = .destroying;

    const opaque_ptr: *anyopaque = @ptrFromInt(slot.ptr);
    const typed_ptr: *T = @ptrCast(@alignCast(opaque_ptr));
    return .{ .handle = handle, .ptr = typed_ptr };
}

pub fn pause(handle: Handle, expected_kind: ObjectKind, comptime T: type) ?DestroyToken(T) {
    const index = validateSlot(handle, expected_kind) orelse return null;
    const slot = &slots[index];
    slot.state = .destroying;

    const opaque_ptr: *anyopaque = @ptrFromInt(slot.ptr);
    const typed_ptr: *T = @ptrCast(@alignCast(opaque_ptr));
    return .{ .handle = handle, .ptr = typed_ptr };
}

pub fn unpause(handle: Handle) void {
    if (handle == 0) return;
    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slot_count) return;
    const slot = &slots[@intCast(index_u32)];
    if (slot.generation != slotGeneration(handle) or slot.state != .destroying or slot.ptr == 0) return;
    slot.state = .alive;
}

pub fn finishDestroy(handle: Handle) void {
    if (handle == 0) return;
    const index_u32 = slotIndex(handle);
    if (index_u32 == 0 or index_u32 >= slot_count) return;
    const index: u16 = @intCast(index_u32);
    const slot = &slots[index];
    if (slot.generation != slotGeneration(handle) or slot.state != .destroying) return;
    vacateSlot(index);
}

pub fn isValid(handle: Handle, expected_kind: ObjectKind) bool {
    return validateSlot(handle, expected_kind) != null;
}

pub fn isOwned(handle: Handle, expected_kind: ObjectKind) bool {
    const index = validateSlot(handle, expected_kind) orelse return false;
    return slots[index].owned;
}

pub fn invalidate(handle: Handle, expected_kind: ObjectKind) void {
    const index = validateSlot(handle, expected_kind) orelse return;
    slots[index].state = .destroying;
    vacateSlot(index);
}

pub fn invalidateChildren(owner: Handle) void {
    while (findChild(owner, null)) |child_handle| {
        const index: u16 = @intCast(slotIndex(child_handle));
        slots[index].state = .destroying;
        invalidateChildren(child_handle);
        vacateSlot(index);
    }
}

pub fn findChild(owner: Handle, kind: ?ObjectKind) ?Handle {
    var index: usize = 1;
    while (index < slot_count) : (index += 1) {
        const slot = &slots[index];
        if (slot.state != .alive or slot.owner != owner) continue;
        const slot_kind: ObjectKind = @enumFromInt(slot.kind);
        if (kind) |expected| {
            if (slot_kind != expected) continue;
        }
        return encode(@intCast(index), slot.generation, slot_kind);
    }
    return null;
}

pub fn nextByKind(kind: ObjectKind, cursor: *usize) ?Handle {
    while (cursor.* < slot_count) {
        const index = cursor.*;
        cursor.* += 1;
        const slot = &slots[index];
        if (slot.state == .alive and slot.kind == @intFromEnum(kind)) {
            return encode(@intCast(index), slot.generation, kind);
        }
    }
    return null;
}

pub fn liveCount(kind: ObjectKind) usize {
    var count: usize = 0;
    var cursor: usize = 1;
    while (nextByKind(kind, &cursor)) |_| count += 1;
    return count;
}

/// Highest slot index ever handed out, +1. Never decreases — saturated indices
/// are retired, not recycled (see `vacateSlot`), so this is the table's
/// monotone capacity high-water mark.
pub fn slotCount() usize {
    return slot_count;
}

/// Indices currently on the free list. A saturated index is deliberately NOT
/// pushed back, so sustained churn consumes this list monotonically — the
/// table's finite-lifetime cost, observable by tests.
pub fn freeIndexCount() usize {
    return free_index_count;
}

pub const TableStats = struct {
    /// Highest slot index ever handed out, +1. Never decreases.
    slot_count: u32,
    /// Indices currently available for reuse.
    free_count: usize,
};

/// Capacity accounting for the shared object table. Exposed because the table
/// is the resource that runs out first: every native object kind draws on the
/// same 65_535 slots, so an exhaustion shows up as a failed allocation of
/// whichever kind happens to be next rather than of the kind that consumed
/// them.
pub fn tableStats() TableStats {
    return .{ .slot_count = slot_count, .free_count = free_index_count };
}
