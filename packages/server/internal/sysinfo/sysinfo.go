// 包 sysinfo 暴露指标端点所需的少量进程信息。
// 它有意只依赖标准库。
package sysinfo

import (
	"runtime"
	"syscall"
)

// RSS 返回峰值常驻内存大小（字节）。Linux 上 Getrusage 以
// 千字节为单位，macOS 上则以字节为单位。
func RSS() uint64 {
	var usage syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &usage); err != nil {
		return 0
	}
	value := uint64(usage.Maxrss)
	if runtime.GOOS == "linux" {
		value *= 1024
	}
	return value
}
