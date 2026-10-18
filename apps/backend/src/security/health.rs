//! Health data (body weight, body fat) is encrypted before it reaches the database: AES-256-GCM with a
//! fresh nonce per value. The key id travels inside the value, so the rows written before a key
//! rotation stay readable while new ones use the new key.

use base64::{Engine, engine::general_purpose::STANDARD};
use ring::{
    aead::{AES_256_GCM, Aad, LessSafeKey, NONCE_LEN, Nonce, UnboundKey},
    rand::{SecureRandom, SystemRandom},
};
use secrecy::{ExposeSecret, SecretString};

use crate::error::AppError;

pub struct HealthCipher {
    /// The first key encrypts; every key decrypts.
    keys: Vec<(String, LessSafeKey)>,
    random: SystemRandom,
}

impl HealthCipher {
    /// `keys` are `(id, base64 of 32 bytes)`, as `HEALTH_DATA_KEYS` holds them.
    pub fn new(keys: &[(String, SecretString)]) -> Result<Self, String> {
        if keys.is_empty() {
            return Err("HEALTH_DATA_KEYS: at least one key is required".into());
        }
        let keys = keys
            .iter()
            .map(|(id, b64)| {
                let bytes = STANDARD
                    .decode(b64.expose_secret())
                    .map_err(|_| format!("HEALTH_DATA_KEYS: key {id} is not base64"))?;
                let key = UnboundKey::new(&AES_256_GCM, &bytes)
                    .map_err(|_| format!("HEALTH_DATA_KEYS: key {id} is not 32 bytes"))?;
                Ok((id.clone(), LessSafeKey::new(key)))
            })
            .collect::<Result<_, String>>()?;
        Ok(Self {
            keys,
            random: SystemRandom::new(),
        })
    }

    /// `[id length][id][nonce][ciphertext and tag]`. The id is also the authenticated data, so a value
    /// cannot be passed off under another key id.
    pub fn encrypt(&self, plain: &str) -> Result<Vec<u8>, AppError> {
        let (id, key) = self
            .keys
            .first()
            .ok_or_else(|| AppError::internal("no health-data key"))?;
        let id_len =
            u8::try_from(id.len()).map_err(|_| AppError::internal("health-data key id too long"))?;
        let mut nonce = [0u8; NONCE_LEN];
        self.random
            .fill(&mut nonce)
            .map_err(|_| AppError::internal("no random nonce"))?;
        let mut sealed = plain.as_bytes().to_vec();
        key.seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(id.as_bytes()),
            &mut sealed,
        )
        .map_err(|_| AppError::internal("health data could not be encrypted"))?;
        let mut blob = Vec::with_capacity(1 + id.len() + NONCE_LEN + sealed.len());
        blob.push(id_len);
        blob.extend_from_slice(id.as_bytes());
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&sealed);
        Ok(blob)
    }

    pub fn decrypt(&self, blob: &[u8]) -> Result<String, AppError> {
        let unreadable = || AppError::internal("health data could not be decrypted");
        let (&id_len, rest) = blob.split_first().ok_or_else(unreadable)?;
        let id_len = usize::from(id_len);
        if rest.len() < id_len + NONCE_LEN {
            return Err(unreadable());
        }
        let (id, rest) = rest.split_at(id_len);
        let (nonce, sealed) = rest.split_at(NONCE_LEN);
        let key = self
            .keys
            .iter()
            .find(|(known, _)| known.as_bytes() == id)
            .map(|(_, key)| key)
            .ok_or_else(unreadable)?;
        let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| unreadable())?;
        let mut buffer = sealed.to_vec();
        let plain = key
            .open_in_place(nonce, Aad::from(id), &mut buffer)
            .map_err(|_| unreadable())?;
        String::from_utf8(plain.to_vec()).map_err(|_| unreadable())
    }

    pub fn encrypt_number(&self, n: f64) -> Result<Vec<u8>, AppError> {
        self.encrypt(&n.to_string())
    }

    pub fn decrypt_number(&self, blob: &[u8]) -> Result<f64, AppError> {
        self.decrypt(blob)?
            .parse()
            .map_err(|_| AppError::internal("health data is not a number"))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn key(id: &str, byte: u8) -> (String, SecretString) {
        (id.to_owned(), STANDARD.encode([byte; 32]).into())
    }

    fn cipher(keys: &[(String, SecretString)]) -> HealthCipher {
        HealthCipher::new(keys).unwrap()
    }

    #[test]
    fn a_value_comes_back() {
        let c = cipher(&[key("k1", 1)]);
        let blob = c.encrypt_number(78.4).unwrap();
        assert_eq!(c.decrypt_number(&blob).unwrap(), 78.4);
        assert!(!blob.windows(4).any(|w| w == b"78.4"));
    }

    #[test]
    fn two_encryptions_of_one_value_differ() {
        let c = cipher(&[key("k1", 1)]);
        assert_ne!(c.encrypt("78.4").unwrap(), c.encrypt("78.4").unwrap());
    }

    #[test]
    fn old_rows_stay_readable_after_a_rotation() {
        let blob = cipher(&[key("k1", 1)]).encrypt("18.5").unwrap();
        let rotated = cipher(&[key("k2", 2), key("k1", 1)]);
        assert_eq!(rotated.decrypt(&blob).unwrap(), "18.5");
        // New values use the new key.
        assert_eq!(&rotated.encrypt("1").unwrap()[1..3], b"k2");
    }

    #[test]
    fn an_unknown_key_id_is_an_error() {
        let blob = cipher(&[key("k1", 1)]).encrypt("78.4").unwrap();
        assert!(cipher(&[key("k2", 2)]).decrypt(&blob).is_err());
    }

    #[test]
    fn a_changed_byte_is_an_error() {
        let c = cipher(&[key("k1", 1)]);
        let mut blob = c.encrypt("78.4").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 1;
        assert!(c.decrypt(&blob).is_err());
        assert!(c.decrypt(&[]).is_err());
        assert!(c.decrypt(&[2, b'k', b'1']).is_err());
    }

    #[test]
    fn a_key_must_be_32_bytes_of_base64() {
        assert!(HealthCipher::new(&[]).is_err());
        assert!(HealthCipher::new(&[("k1".into(), STANDARD.encode([1u8; 16]).into())]).is_err());
        assert!(HealthCipher::new(&[("k1".into(), "not base64!".to_owned().into())]).is_err());
    }
}
