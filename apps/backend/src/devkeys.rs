//! A fresh Ed25519 key pair for signing access tokens, in the format the configuration expects.
//! Used by `backend keys` on a developer machine and by the tests. Needs the `openssl` command.

use std::{
    io::Write,
    process::{Command, Stdio},
};

use base64::{Engine, engine::general_purpose::STANDARD};

/// Returns `(private key, public key)`, each a PEM document encoded in base64 on one line.
pub fn generate() -> Result<(String, String), String> {
    let private = Command::new("openssl")
        .args(["genpkey", "-algorithm", "ed25519"])
        .output()
        .map_err(|e| format!("openssl: {e}"))?;
    if !private.status.success() {
        return Err("openssl genpkey failed".into());
    }
    let mut child = Command::new("openssl")
        .args(["pkey", "-pubout"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("openssl: {e}"))?;
    // The pipe closes when this temporary is dropped, which lets openssl finish.
    child.stdin.take().ok_or("openssl: no stdin")?.write_all(&private.stdout).map_err(|e| e.to_string())?;
    let public = child.wait_with_output().map_err(|e| e.to_string())?;
    if !public.status.success() {
        return Err("openssl pkey failed".into());
    }
    Ok((STANDARD.encode(&private.stdout), STANDARD.encode(&public.stdout)))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    #[test]
    fn generates_a_matching_pair_of_pem_documents() {
        let (private, public) = generate().unwrap();
        let private = String::from_utf8(STANDARD.decode(private).unwrap()).unwrap();
        let public = String::from_utf8(STANDARD.decode(public).unwrap()).unwrap();
        assert!(private.contains("-----BEGIN PRIVATE KEY-----"));
        assert!(public.contains("-----BEGIN PUBLIC KEY-----"));
    }
}
