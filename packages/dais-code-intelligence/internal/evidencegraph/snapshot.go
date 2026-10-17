package evidencegraph

import "context"

func (s *Store) Snapshot(ctx context.Context, id string) (Snapshot, error) {
	snapshot, _, _, err := s.load(ctx, id)
	return snapshot, err
}
