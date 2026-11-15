package sharelink

import "testing"

func TestSignerStableAndBound(t *testing.T) {
	signer := NewSigner("0123456789abcdef")
	const token = "0123456789abcdef0123456789abcdef"
	const version = "5938330-1794724430144"

	first := signer.Sign(token, 0, version)
	if again := signer.Sign(token, 0, version); again != first {
		t.Fatalf("同一输入应得到同一签名: %q != %q", first, again)
	}
	if !signer.Verify(token, 0, version, first) {
		t.Fatal("自身签名应校验通过")
	}

	// 分享、文件下标、版本任意一段变化都必须验不过
	if signer.Verify("ffffffffffffffffffffffffffffffff", 0, version, first) {
		t.Fatal("换分享不应通过")
	}
	if signer.Verify(token, 1, version, first) {
		t.Fatal("换文件下标不应通过")
	}
	if signer.Verify(token, 0, "1-1", first) {
		t.Fatal("换版本不应通过")
	}
	if signer.Verify(token, 0, version, "") {
		t.Fatal("空签名不应通过")
	}
	if signer.Verify(token, 0, version, first+"x") {
		t.Fatal("篡改签名不应通过")
	}
}

func TestSignerKeyRotation(t *testing.T) {
	old := NewSigner("old-secret-0123456789")
	rotated := NewSigner("new-secret-0123456789")
	const token = "0123456789abcdef0123456789abcdef"
	const version = "10-20"

	signature := old.Sign(token, 0, version)
	if rotated.Verify(token, 0, version, signature) {
		t.Fatal("换密钥后旧签名必须失效")
	}
	if !rotated.Verify(token, 0, version, rotated.Sign(token, 0, version)) {
		t.Fatal("新密钥签发的签名应校验通过")
	}
}
