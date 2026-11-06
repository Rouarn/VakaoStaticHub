package store

import (
	"context"
	"database/sql"
	"errors"

	"vakao-static-hub/server/internal/model"
)

func (s *Store) ListRoots(ctx context.Context) ([]model.ResourceRoot, error) {
	rows, err := s.Reader.QueryContext(ctx,
		`SELECT id, name, path, description, sort_order, created_at, updated_at
		 FROM resource_roots
		 ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, created_at, rowid`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	roots := make([]model.ResourceRoot, 0, 8)
	for rows.Next() {
		var (
			r         model.ResourceRoot
			createdAt int64
			updatedAt int64
		)
		if err := rows.Scan(&r.ID, &r.Name, &r.Path, &r.Description, &r.SortOrder, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		r.CreatedAt = Time(createdAt)
		r.UpdatedAt = Time(updatedAt)
		roots = append(roots, r)
	}
	return roots, rows.Err()
}

func (s *Store) RootByID(ctx context.Context, id string) (*model.ResourceRoot, error) {
	var (
		r         model.ResourceRoot
		createdAt int64
		updatedAt int64
	)
	err := s.Reader.QueryRowContext(ctx,
		`SELECT id, name, path, description, sort_order, created_at, updated_at
		 FROM resource_roots WHERE id = ?`, id).
		Scan(&r.ID, &r.Name, &r.Path, &r.Description, &r.SortOrder, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	r.CreatedAt = Time(createdAt)
	r.UpdatedAt = Time(updatedAt)
	return &r, nil
}

func (s *Store) RootByPath(ctx context.Context, path string) (*model.ResourceRoot, error) {
	var (
		r         model.ResourceRoot
		createdAt int64
		updatedAt int64
	)
	err := s.Reader.QueryRowContext(ctx,
		`SELECT id, name, path, description, sort_order, created_at, updated_at
		 FROM resource_roots WHERE path = ?`, path).
		Scan(&r.ID, &r.Name, &r.Path, &r.Description, &r.SortOrder, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	r.CreatedAt = Time(createdAt)
	r.UpdatedAt = Time(updatedAt)
	return &r, nil
}

func (s *Store) CreateRoot(ctx context.Context, r model.ResourceRoot) error {
	now := NowMS()
	_, err := s.Writer.ExecContext(ctx,
		`INSERT INTO resource_roots (id, name, path, description, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		r.ID, r.Name, r.Path, r.Description, r.SortOrder, now, now)
	if err != nil && isUniqueViolation(err) {
		return ErrConflict
	}
	return err
}

type RootUpdate struct {
	Name        *string
	Path        *string
	Description *string
}

func (s *Store) UpdateRoot(ctx context.Context, id string, update RootUpdate) (model.ResourceRoot, error) {
	tx, err := s.Writer.BeginTx(ctx, nil)
	if err != nil {
		return model.ResourceRoot{}, err
	}
	defer tx.Rollback()

	var (
		r         model.ResourceRoot
		createdAt int64
		updatedAt int64
	)
	err = tx.QueryRowContext(ctx,
		`SELECT id, name, path, description, sort_order, created_at, updated_at
		 FROM resource_roots WHERE id = ?`, id).
		Scan(&r.ID, &r.Name, &r.Path, &r.Description, &r.SortOrder, &createdAt, &updatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return model.ResourceRoot{}, ErrNotFound
	}
	if err != nil {
		return model.ResourceRoot{}, err
	}
	if update.Name != nil {
		r.Name = *update.Name
	}
	if update.Path != nil {
		r.Path = *update.Path
	}
	if update.Description != nil {
		r.Description = *update.Description
	}
	updatedAt = NowMS()
	if _, err := tx.ExecContext(ctx,
		`UPDATE resource_roots SET name = ?, path = ?, description = ?, updated_at = ?
		 WHERE id = ?`, r.Name, r.Path, r.Description, updatedAt, id); err != nil {
		if isUniqueViolation(err) {
			return model.ResourceRoot{}, ErrConflict
		}
		return model.ResourceRoot{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.ResourceRoot{}, err
	}
	r.CreatedAt = Time(createdAt)
	r.UpdatedAt = Time(updatedAt)
	return r, nil
}

func (s *Store) DeleteRoot(ctx context.Context, id string) error {
	res, err := s.Writer.ExecContext(ctx, "DELETE FROM resource_roots WHERE id = ?", id)
	if err != nil {
		return err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) CountFileEntriesByRoot(ctx context.Context, rootID string) (int, error) {
	var n int
	err := s.Reader.QueryRowContext(ctx,
		"SELECT COUNT(1) FROM file_entries WHERE root_id = ?", rootID).Scan(&n)
	return n, err
}
