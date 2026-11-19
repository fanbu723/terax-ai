//! Minimal base64 codec for the SSH wire payloads.
//!
//! File contents and remote path arguments cross the SSH transport base64
//! encoded, so no shell metacharacter can ever become syntax. The app ships no
//! standalone base64 dependency and the transport only needs the standard
//! alphabet with padding, so the codec lives here and is unit tested.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn decode_char(byte: u8) -> Option<u8> {
    match byte {
        b'A'..=b'Z' => Some(byte - b'A'),
        b'a'..=b'z' => Some(byte - b'a' + 26),
        b'0'..=b'9' => Some(byte - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Encode bytes as standard padded base64.
pub fn encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(triple >> 18) as usize & 0x3f] as char);
        out.push(ALPHABET[(triple >> 12) as usize & 0x3f] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(triple >> 6) as usize & 0x3f] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[triple as usize & 0x3f] as char
        } else {
            '='
        });
    }
    out
}

/// Decode standard base64, ignoring ASCII whitespace (the remote side wraps
/// long payloads through `base64`'s default 76-column output).
pub fn decode(input: &str) -> Result<Vec<u8>, String> {
    let mut cleaned = Vec::with_capacity(input.len());
    for byte in input.bytes() {
        if byte.is_ascii_whitespace() {
            continue;
        }
        cleaned.push(byte);
    }
    if cleaned.len() % 4 != 0 {
        return Err("base64 payload is not a whole number of quanta".into());
    }
    let mut out = Vec::with_capacity(cleaned.len() / 4 * 3);
    let mut index = 0;
    while index < cleaned.len() {
        let quantum = &cleaned[index..index + 4];
        let mut values = [0u8; 4];
        let mut padding = 0;
        for (slot, byte) in quantum.iter().enumerate() {
            if *byte == b'=' {
                // Padding is only legal in the last two positions of the last
                // quantum, and everything after it must be padding too.
                if slot < 2 || index + 4 != cleaned.len() {
                    return Err("base64 payload has misplaced padding".into());
                }
                padding += 1;
                values[slot] = 0;
                continue;
            }
            if padding > 0 {
                return Err("base64 payload has data after padding".into());
            }
            values[slot] = decode_char(*byte)
                .ok_or_else(|| "base64 payload contains a non-alphabet byte".to_string())?;
        }
        let triple = ((values[0] as u32) << 18)
            | ((values[1] as u32) << 12)
            | ((values[2] as u32) << 6)
            | values[3] as u32;
        out.push((triple >> 16) as u8);
        if padding < 2 {
            out.push((triple >> 8) as u8);
        }
        if padding < 1 {
            out.push(triple as u8);
        }
        index += 4;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_every_length_modulo_three() {
        for len in 0..=8usize {
            let bytes: Vec<u8> = (0..len).map(|i| (i * 37 + 11) as u8).collect();
            let encoded = encode(&bytes);
            assert_eq!(decode(&encoded).unwrap(), bytes, "len {len}");
        }
    }

    #[test]
    fn encodes_the_rfc4648_vectors() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foo"), "Zm9v");
        assert_eq!(encode(b"foob"), "Zm9vYg==");
        assert_eq!(encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn decodes_wrapped_output() {
        let bytes: Vec<u8> = (0..200u32).map(|i| (i % 251) as u8).collect();
        let encoded = encode(&bytes);
        let wrapped: String = encoded
            .as_bytes()
            .chunks(76)
            .map(|chunk| format!("{}\n", std::str::from_utf8(chunk).unwrap()))
            .collect();
        assert_eq!(decode(&wrapped).unwrap(), bytes);
    }

    #[test]
    fn rejects_malformed_payloads() {
        assert!(decode("A").is_err());
        assert!(decode("AAAAA").is_err());
        assert!(decode("AA=A").is_err());
        assert!(decode("A===").is_err());
        assert!(decode("AA*A").is_err());
        assert!(decode("A AAA").is_ok());
    }
}
