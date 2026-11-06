#!/usr/bin/env bash
# 构建可直接部署的发布包：前端产物 + 静态编译的 Go 后端。
# 用法：pnpm package [-- --goos linux --goarch amd64 --version 0.0.1]
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

GOOS_VALUE="linux"
GOARCH_VALUE="amd64"
VERSION=""

usage() {
	cat <<'EOF'
用法：pnpm package [选项]

选项：
  --goos <系统>      目标操作系统，默认 linux
  --goarch <架构>    目标架构，默认 amd64
  --version <版本号> 写入二进制与包名的版本号，默认取根 package.json 的 version
  -h, --help         显示本帮助

示例：
  pnpm package
  pnpm package --goos linux --goarch arm64 --version 1.2.3
EOF
}

die() {
	printf '错误：%s\n' "$*" >&2
	exit 1
}

random_hex() {
	local bytes="$1"
	if command -v openssl >/dev/null 2>&1; then
		openssl rand -hex "$bytes"
	elif command -v node >/dev/null 2>&1; then
		node -e "process.stdout.write(require('crypto').randomBytes(${bytes}).toString('hex'))"
	else
		die "未找到 openssl 或 node，无法生成随机密钥"
	fi
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--)
		# 兼容 npm/pnpm 传入的分隔符
		shift
		;;
	--goos)
		[[ $# -ge 2 ]] || die "--goos 缺少参数值"
		GOOS_VALUE="$2"
		shift 2
		;;
	--goos=*)
		GOOS_VALUE="${1#*=}"
		shift
		;;
	--goarch)
		[[ $# -ge 2 ]] || die "--goarch 缺少参数值"
		GOARCH_VALUE="$2"
		shift 2
		;;
	--goarch=*)
		GOARCH_VALUE="${1#*=}"
		shift
		;;
	--version)
		[[ $# -ge 2 ]] || die "--version 缺少参数值"
		VERSION="$2"
		shift 2
		;;
	--version=*)
		VERSION="${1#*=}"
		shift
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		die "未知参数：$1（使用 --help 查看用法）"
		;;
	esac
done

command -v go >/dev/null 2>&1 || die "未找到 go，请先安装 Go（需要 1.27 或更高版本）并加入 PATH"
command -v pnpm >/dev/null 2>&1 || die "未找到 pnpm，请先安装 pnpm（需要 10.15 或更高版本）并加入 PATH"
command -v node >/dev/null 2>&1 || die "未找到 node，请先安装 Node.js（需要 22.18 或更高版本）"
command -v tar >/dev/null 2>&1 || die "未找到 tar，请先安装 tar"

if [[ -z "$VERSION" ]]; then
	VERSION="$(node -p "require('./package.json').version" 2>/dev/null)" ||
		die "无法从根 package.json 读取 version，请用 --version 显式指定"
fi
[[ -n "$VERSION" ]] || die "版本号不能为空"

[[ "$GOOS_VALUE" =~ ^[a-z0-9]+$ ]] || die "GOOS 不合法：$GOOS_VALUE"
[[ "$GOARCH_VALUE" =~ ^[a-z0-9]+$ ]] || die "GOARCH 不合法：$GOARCH_VALUE"

NAME="vakao-static-hub-${VERSION}-${GOOS_VALUE}-${GOARCH_VALUE}"
DEST="$ROOT_DIR/release/$NAME"
ARCHIVE="$DEST.tar.gz"

mkdir -p "$ROOT_DIR/release"
if [[ -e "$DEST" ]]; then
	die "发布目录已存在，不会覆盖：release/$NAME"
fi
if [[ -e "$ARCHIVE" ]]; then
	die "压缩包已存在，不会覆盖：release/$NAME.tar.gz"
fi

WORK_DIR="$(mktemp -d "$ROOT_DIR/release/.package-XXXXXX")"
FINISHED=0

cleanup() {
	rm -rf "$WORK_DIR"
	if [[ $FINISHED -ne 1 ]]; then
		rm -rf "$DEST" "$ARCHIVE"
	fi
}
trap cleanup EXIT

printf '==> 构建 @vakao/shared\n'
pnpm --filter @vakao/shared build

printf '==> 构建 @vakao/client\n'
pnpm --filter @vakao/client build

[[ -f "$ROOT_DIR/packages/client/dist/index.html" ]] ||
	die "前端构建产物缺失：packages/client/dist/index.html"

printf '==> 交叉编译服务端（%s/%s，版本 %s）\n' "$GOOS_VALUE" "$GOARCH_VALUE" "$VERSION"
CGO_ENABLED=0 GOOS="$GOOS_VALUE" GOARCH="$GOARCH_VALUE" \
	go -C "$ROOT_DIR/packages/server" build -trimpath \
	-ldflags "-s -w -X main.version=$VERSION" \
	-o "$WORK_DIR/vakao-server" ./cmd/server

printf '==> 组装发布目录\n'
# 说明：这里刻意不打包 resource-roots.json。它只在空库首次启动时用于播种
# 根目录，缺失时服务端会回退到内置的 default 与 software-update，
# 所以不带它不影响运行；反之带上开发机的路径反而会把线上根目录指错。
JWT_SECRET="$(random_hex 32)"
AUTH_PASS="$(random_hex 16)"
mkdir -p "$WORK_DIR/web" "$WORK_DIR/data"
cp -R "$ROOT_DIR/packages/client/dist/." "$WORK_DIR/web/"
cp "$ROOT_DIR/scripts/release-readme.md" "$WORK_DIR/README.md"
cp "$ROOT_DIR/.env.example" "$WORK_DIR/.env.example"

cat >"$WORK_DIR/.env" <<EOF
# 服务监听
HOST=0.0.0.0
PORT=9865
BASE_DIR=.

# 认证（首次启动会用它播种管理员）
AUTH_USER=admin
AUTH_PASS=${AUTH_PASS}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=12h

# 跨域与反向代理
CORS_ORIGIN=
TRUST_PROXY=false

# 数据与存储
DB_PATH=data/vakao.db
FILE_ROOT=data
RESOURCE_ROOTS_FILE=resource-roots.json
UPLOAD_TEMP_DIR=data/.uploads
CACHE_DIR=data/.cache
WEB_DIR=web

# 上传与图片（2 核 2G 取值）
UPLOAD_MAX_COUNT=20
DEFAULT_CATEGORY=TemporaryFile
CHUNK_FILE_SIZE_LIMIT=104857600
MAX_IMAGE_PIXELS=60000000
MAX_IMAGE_DIMENSION=4096
THUMB_CONCURRENCY=2
THUMB_CACHE_RETENTION_DAYS=30
THUMB_CACHE_MAX_MB=256
CLEANUP_AT=03:00
CACHE_REFRESH_INTERVAL_MS=300000

# 目录浏览与外部服务
ROOT_BROWSE_WHITELIST=
HITOKOTO_API_URL=https://static.shixian.xyz/static/hitokoto
APP_PUBLIC_BASE_URL=

# 日志
LOG_LEVEL=info
EOF
chmod 600 "$WORK_DIR/.env"
chmod +x "$WORK_DIR/vakao-server"
chmod 755 "$WORK_DIR" "$WORK_DIR/data" "$WORK_DIR/web"

mv "$WORK_DIR" "$DEST"

printf '==> 生成压缩包\n'
tar -C "$ROOT_DIR/release" -czf "$ARCHIVE" "$NAME"

FINISHED=1

printf '\n完成：release/%s.tar.gz\n' "$NAME"
du -h "$ARCHIVE" | awk '{print "大小：" $1}'
printf '初始管理员：admin\n'
printf '初始密码：%s\n' "$AUTH_PASS"
printf '发布包：%s\n' "$ARCHIVE"
printf '提示：该密码只用于首次启动播种管理员，登录后请立即修改。\n'
