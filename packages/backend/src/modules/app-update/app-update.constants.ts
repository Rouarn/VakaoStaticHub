/** APP 更新模块常量 */

/** 软件更新专用资源根目录 ID（resource-roots.json 中幂等注册） */
export const SOFTWARE_UPDATE_ROOT_ID = 'software-update';

/** 软件更新专用资源根的默认相对路径（backend 包根下 data 的子目录，便于后续扩展 win/macOS 等多平台分发） */
export const SOFTWARE_UPDATE_ROOT_PATH = 'data/software-update';

/** 环境变量：外部可访问的基础地址（可选，优先于请求头动态拼接） */
export const ENV_PUBLIC_BASE_URL = 'APP_PUBLIC_BASE_URL';
