package httpapi

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"vakao-static-hub/server/internal/auth"
	"vakao-static-hub/server/internal/model"
	"vakao-static-hub/server/internal/store"
)

var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$`)

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	ip := clientIP(r, s.cfg.TrustProxy)
	if !s.loginLimiter.allow(ip) {
		return tooManyRequests("登录尝试过于频繁，请稍后再试")
	}

	var req model.LoginRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	req.Username = strings.TrimSpace(req.Username)
	if req.Username == "" || req.Password == "" {
		return badRequest("用户名和密码不能为空")
	}

	record, err := s.store.UserByUsername(r.Context(), req.Username)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return unauthorized("用户名或密码错误")
		}
		return internalError(err)
	}
	if !auth.VerifyPassword(req.Password, record.PasswordHash) {
		return unauthorized("用户名或密码错误")
	}

	token, expiresAt, err := s.tokens.Issue(record.ID, record.Username, record.Role)
	if err != nil {
		return internalError(err)
	}
	s.audit(r, &CurrentUser{ID: record.ID, Username: record.Username, Role: record.Role},
		"user.login", "user", strconv.FormatInt(record.ID, 10), nil)

	writeJSON(w, model.LoginResponse{
		Token:     token,
		TokenType: "Bearer",
		ExpiresAt: expiresAt.UTC(),
		User:      record.User,
	})
	return nil
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request, current *CurrentUser) error {
	record, err := s.store.UserByID(r.Context(), current.ID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return unauthorized("账号已不存在")
		}
		return internalError(err)
	}
	writeJSON(w, record.User)
	return nil
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request, current *CurrentUser) error {
	// Token 是无状态的，由客户端自行丢弃。修改密码会通过
	// users.updated_at 校验使旧 Token 失效。
	if current != nil {
		s.audit(r, current, "user.logout", "user", strconv.FormatInt(current.ID, 10), nil)
	}
	writeJSON(w, nil)
	return nil
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request, current *CurrentUser) error {
	var req model.ChangePasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	if err := validatePassword(req.NewPassword); err != nil {
		return err
	}
	record, err := s.store.UserByID(r.Context(), current.ID)
	if err != nil {
		return internalError(err)
	}
	if !auth.VerifyPassword(req.OldPassword, record.PasswordHash) {
		return badRequest("当前密码错误").WithField("oldPassword", "当前密码错误")
	}
	hash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		return internalError(err)
	}
	if err := s.store.UpdatePassword(r.Context(), current.ID, hash); err != nil {
		return internalError(err)
	}
	s.audit(r, current, "user.change_password", "user", strconv.FormatInt(current.ID, 10), nil)
	writeJSON(w, nil)
	return nil
}

func (s *Server) handleListUsers(w http.ResponseWriter, r *http.Request, _ *CurrentUser) error {
	page, pageSize := pagination(r)
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	users, total, err := s.store.ListUsers(r.Context(), page, pageSize, query)
	if err != nil {
		return internalError(err)
	}
	writeJSON(w, model.Page[model.User]{
		Items:    users,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
	return nil
}

func (s *Server) handleCreateUser(w http.ResponseWriter, r *http.Request, user *CurrentUser) error {
	var req model.CreateUserRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	req.Username = strings.TrimSpace(req.Username)
	if !usernamePattern.MatchString(req.Username) {
		return validationFailed("用户名无效").WithField("username", "需为 3-32 个字符，仅限字母、数字、点、短横线或下划线")
	}
	if err := validatePassword(req.Password); err != nil {
		return err
	}
	role := strings.TrimSpace(req.Role)
	if role == "" {
		role = "user"
	}
	if role != "admin" && role != "user" {
		return validationFailed("角色无效").WithField("role", "只能为 admin 或 user")
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return internalError(err)
	}
	created, err := s.store.CreateUser(r.Context(), req.Username, hash, role)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			return conflict("用户名已存在")
		}
		return internalError(err)
	}
	s.audit(r, user, "user.register", "user", strconv.FormatInt(created.ID, 10), map[string]any{"role": created.Role})
	writeJSON(w, created)
	return nil
}

func (s *Server) handleResetPassword(w http.ResponseWriter, r *http.Request, current *CurrentUser) error {
	id, err := parseInt64(pathValue(r, "id"), "用户 id")
	if err != nil {
		return err
	}
	var req model.ResetPasswordRequest
	if err := decodeJSON(w, r, &req); err != nil {
		return err
	}
	if err := validatePassword(req.Password); err != nil {
		return err
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		return internalError(err)
	}
	if err := s.store.UpdatePassword(r.Context(), id, hash); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("用户不存在")
		}
		return internalError(err)
	}
	s.audit(r, current, "user.reset_password", "user", strconv.FormatInt(id, 10), nil)
	writeJSON(w, nil)
	return nil
}

func (s *Server) handleDeleteUser(w http.ResponseWriter, r *http.Request, current *CurrentUser) error {
	id, err := parseInt64(pathValue(r, "id"), "用户 id")
	if err != nil {
		return err
	}
	if id == current.ID {
		return conflict("不能删除当前登录的账号")
	}
	target, err := s.store.UserByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("用户不存在")
		}
		return internalError(err)
	}
	if target.Role == "admin" {
		admins, err := s.store.CountAdmins(r.Context())
		if err != nil {
			return internalError(err)
		}
		if admins <= 1 {
			return conflict("不能删除最后一个管理员")
		}
	}
	if err := s.store.DeleteUser(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return notFound("用户不存在")
		}
		return internalError(err)
	}
	s.audit(r, current, "user.delete", "user", strconv.FormatInt(id, 10), map[string]any{"username": target.Username})
	writeJSON(w, nil)
	return nil
}

func validatePassword(password string) error {
	if len(password) < 6 {
		return validationFailed("密码无效").WithField("password", "至少 6 个字符")
	}
	if len(password) > 128 {
		return validationFailed("密码无效").WithField("password", "最多 128 个字符")
	}
	return nil
}
