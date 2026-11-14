/** 公开分享页的状态机 */
export type ShareAccessPhase =
  | 'loading'
  | 'error'
  | 'notfound'
  | 'disabled'
  | 'gate'
  | 'expired'
  | 'exhausted'
  | 'ready';
