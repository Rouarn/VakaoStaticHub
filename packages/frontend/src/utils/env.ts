/**
 * 获取基础地址（不带 /static 前缀）
 * 如果环境变量配置为 'origin'，则使用当前页面的 origin
 */
export const getBaseUrl = () => {
  const envBaseURL = import.meta.env.VITE_API_BASE_URL;
  return envBaseURL === 'origin' ? window.location.origin : envBaseURL;
};

/**
 * 获取 API 基础地址
 * 如果环境变量配置为 'origin'，则使用当前页面的 origin
 * 自动添加 /static 前缀
 */
export const getApiBaseUrl = () => {
  return `${getBaseUrl()}/static`;
};
