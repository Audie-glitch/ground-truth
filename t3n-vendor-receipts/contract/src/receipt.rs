//! Canonical invoice fields, content hash, and store operations.
//!
//! Native tests use `MemoryStore`. The WASM guest uses the same functions
//! against `host:interfaces/kv-store`.

extern crate alloc;

use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use serde::{Deserialize, Serialize};

pub const SCHEMA: &str = "v1";
pub const MAX_INDEX: usize = 256;
pub const INDEX_KEY: &[u8] = b"idx";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReceiptInput {
    pub vendor: String,
    pub invoice_id: String,
    pub amount: String,
    pub currency: String,
    pub issued_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FiledReceipt {
    pub id: String,
    pub vendor: String,
    pub invoice_id: String,
    pub amount: String,
    pub currency: String,
    pub issued_at: String,
    pub content_hash: String,
    pub status: String,
}

pub trait ReceiptStore {
    fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>, String>;
    fn put(&mut self, key: &[u8], value: &[u8]) -> Result<(), String>;
}

pub fn canonicalize_vendor(raw: &str) -> Result<String, String> {
    let mut out = String::new();
    for word in raw.split_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&word.to_ascii_lowercase());
    }
    if out.is_empty() {
        return Err("vendor is empty".into());
    }
    if out.len() > 80 {
        return Err("vendor is longer than 80 characters".into());
    }
    Ok(out)
}

pub fn canonicalize_invoice_id(raw: &str) -> Result<String, String> {
    let id = raw.trim();
    if id.is_empty() {
        return Err("invoice_id is empty".into());
    }
    if id.len() > 64 {
        return Err("invoice_id is longer than 64 characters".into());
    }
    if !id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'/' | b'-'))
    {
        return Err("invoice_id must be [A-Za-z0-9._/-]".into());
    }
    Ok(id.to_string())
}

pub fn canonicalize_amount(raw: &str) -> Result<String, String> {
    let amount = raw.trim();
    if amount.is_empty() {
        return Err("amount is empty".into());
    }
    if amount.bytes().any(|b| b == b'e' || b == b'E') {
        return Err("amount must not use scientific notation".into());
    }
    let (int_raw, frac_raw) = match amount.split_once('.') {
        Some((int_part, frac_part)) => (int_part, Some(frac_part)),
        None => (amount, None),
    };
    if int_raw.is_empty() || !int_raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err("amount integer part must be digits".into());
    }
    if let Some(frac_part) = frac_raw {
        if frac_part.is_empty() || frac_part.len() > 18 || !frac_part.bytes().all(|b| b.is_ascii_digit())
        {
            return Err("amount fraction must be 1-18 digits".into());
        }
    }
    let int_norm = int_raw.trim_start_matches('0');
    let int_norm = if int_norm.is_empty() { "0" } else { int_norm };
    Ok(match frac_raw {
        None => int_norm.to_string(),
        Some(frac_part) => {
            let frac_norm = frac_part.trim_end_matches('0');
            if frac_norm.is_empty() {
                int_norm.to_string()
            } else {
                format!("{int_norm}.{frac_norm}")
            }
        }
    })
}

pub fn canonicalize_currency(raw: &str) -> Result<String, String> {
    let currency = raw.trim().to_ascii_uppercase();
    if currency.len() != 3 || !currency.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err("currency must be a 3-letter ISO code".into());
    }
    Ok(currency)
}

pub fn canonicalize_issued_at(raw: &str) -> Result<String, String> {
    let issued = raw.trim();
    let date = issued.split('T').next().unwrap_or(issued);
    if date.len() != 10 || date.as_bytes()[4] != b'-' || date.as_bytes()[7] != b'-' {
        return Err("issued_at must be YYYY-MM-DD".into());
    }
    let y = &date[0..4];
    let m = &date[5..7];
    let d = &date[8..10];
    if !y.bytes().all(|b| b.is_ascii_digit())
        || !m.bytes().all(|b| b.is_ascii_digit())
        || !d.bytes().all(|b| b.is_ascii_digit())
    {
        return Err("issued_at must be YYYY-MM-DD".into());
    }
    let month: u8 = m.parse().map_err(|_| "issued_at month is invalid")?;
    let day: u8 = d.parse().map_err(|_| "issued_at day is invalid")?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err("issued_at date is out of range".into());
    }
    Ok(date.to_string())
}

pub fn canonicalize(input: &ReceiptInput) -> Result<ReceiptInput, String> {
    Ok(ReceiptInput {
        vendor: canonicalize_vendor(&input.vendor)?,
        invoice_id: canonicalize_invoice_id(&input.invoice_id)?,
        amount: canonicalize_amount(&input.amount)?,
        currency: canonicalize_currency(&input.currency)?,
        issued_at: canonicalize_issued_at(&input.issued_at)?,
    })
}

pub fn content_hash(tenant_hex: &str, canon: &ReceiptInput) -> String {
    use sha2::{Digest, Sha256};
    let preimage = format!(
        "{SCHEMA}|{tenant_hex}|{}|{}|{}|{}|{}",
        canon.vendor, canon.invoice_id, canon.amount, canon.currency, canon.issued_at
    );
    hex::encode(Sha256::digest(preimage.as_bytes()))
}

pub fn receipt_id(tenant_hex: &str, canon: &ReceiptInput) -> String {
    content_hash(tenant_hex, canon)
}

pub fn receipt_key(id: &str) -> Vec<u8> {
    format!("r:{id}").into_bytes()
}

fn parse_index(bytes: Option<Vec<u8>>) -> Result<Vec<String>, String> {
    match bytes {
        None => Ok(Vec::new()),
        Some(raw) => serde_json::from_slice(&raw).map_err(|e| format!("idx: {e}")),
    }
}

pub fn file_receipt<S: ReceiptStore>(
    store: &mut S,
    tenant_hex: &str,
    input: &ReceiptInput,
) -> Result<FiledReceipt, String> {
    let canon = canonicalize(input)?;
    let id = receipt_id(tenant_hex, &canon);
    let key = receipt_key(&id);
    if let Some(existing) = store.get(&key)? {
        let mut filed: FiledReceipt =
            serde_json::from_slice(&existing).map_err(|e| format!("stored receipt: {e}"))?;
        filed.status = "exists".into();
        return Ok(filed);
    }
    let filed = FiledReceipt {
        id: id.clone(),
        vendor: canon.vendor,
        invoice_id: canon.invoice_id,
        amount: canon.amount,
        currency: canon.currency,
        issued_at: canon.issued_at,
        content_hash: id.clone(),
        status: "filed".into(),
    };
    store.put(&key, &serde_json::to_vec(&filed).map_err(|e| e.to_string())?)?;
    let mut ids = parse_index(store.get(INDEX_KEY)?)?;
    if !ids.iter().any(|item| item == &id) {
        if ids.len() >= MAX_INDEX {
            return Err("receipt index is full (256)".into());
        }
        ids.push(id);
        store.put(INDEX_KEY, &serde_json::to_vec(&ids).map_err(|e| e.to_string())?)?;
    }
    Ok(filed)
}

pub fn get_receipt<S: ReceiptStore>(store: &S, id: &str) -> Result<FiledReceipt, String> {
    if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("receipt id must be a 64-char hex sha256".into());
    }
    let raw = store
        .get(&receipt_key(id))?
        .ok_or_else(|| format!("receipt {id} not found"))?;
    serde_json::from_slice(&raw).map_err(|e| format!("stored receipt: {e}"))
}

pub fn list_receipts<S: ReceiptStore>(store: &S) -> Result<Vec<String>, String> {
    parse_index(store.get(INDEX_KEY)?)
}

pub fn verify_receipt<S: ReceiptStore>(
    store: &S,
    tenant_hex: &str,
    id: &str,
    claimed: &ReceiptInput,
) -> Result<serde_json::Value, String> {
    let stored = get_receipt(store, id)?;
    let canon = canonicalize(claimed)?;
    let claimed_hash = content_hash(tenant_hex, &canon);
    let matched = claimed_hash == stored.content_hash && claimed_hash == id;
    Ok(serde_json::json!({
        "id": id,
        "match": matched,
        "stored_hash": stored.content_hash,
        "claimed_hash": claimed_hash,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    struct MemoryStore {
        inner: RefCell<HashMap<Vec<u8>, Vec<u8>>>,
    }

    impl MemoryStore {
        fn new() -> Self {
            Self {
                inner: RefCell::new(HashMap::new()),
            }
        }
    }

    impl ReceiptStore for MemoryStore {
        fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>, String> {
            Ok(self.inner.borrow().get(key).cloned())
        }

        fn put(&mut self, key: &[u8], value: &[u8]) -> Result<(), String> {
            self.inner.borrow_mut().insert(key.to_vec(), value.to_vec());
            Ok(())
        }
    }

    fn acme() -> ReceiptInput {
        ReceiptInput {
            vendor: "  Acme   Supplies ".into(),
            invoice_id: "INV-1001".into(),
            amount: "100.10".into(),
            currency: "usd".into(),
            issued_at: "2026-09-03".into(),
        }
    }

    #[test]
    fn canonicalizes_vendor_amount_currency_and_date() {
        let c = canonicalize(&acme()).expect("valid invoice");
        assert_eq!(c.vendor, "acme supplies");
        assert_eq!(c.invoice_id, "INV-1001");
        assert_eq!(c.amount, "100.1");
        assert_eq!(c.currency, "USD");
        assert_eq!(c.issued_at, "2026-09-03");
    }

    #[test]
    fn golden_hash_matches_sha256_of_canonical_string() {
        let c = canonicalize(&acme()).unwrap();
        assert_eq!(
            content_hash("00", &c),
            "00aec261518bedec3f83956bbd73d1b7ee89b9c95a11c3aa3d96597b8b6a9be4"
        );
    }

    #[test]
    fn rejects_scientific_notation_and_empty_fields() {
        let mut bad = acme();
        bad.amount = "1e2".into();
        assert!(canonicalize(&bad).unwrap_err().contains("amount"));
        bad.amount = "100.10".into();
        bad.vendor = "   ".into();
        assert!(canonicalize(&bad).unwrap_err().contains("vendor"));
        bad.vendor = "Acme".into();
        bad.invoice_id = "INV 1001".into();
        assert!(canonicalize(&bad).unwrap_err().contains("invoice"));
        bad.invoice_id = "INV-1001".into();
        bad.currency = "US".into();
        assert!(canonicalize(&bad).unwrap_err().contains("currency"));
        bad.currency = "USD".into();
        bad.issued_at = "03/09/2026".into();
        assert!(canonicalize(&bad).unwrap_err().contains("issued"));
    }

    #[test]
    fn file_get_list_and_idempotent_duplicate() {
        let mut store = MemoryStore::new();
        let first = file_receipt(&mut store, "00", &acme()).unwrap();
        assert_eq!(
            first.id,
            "00aec261518bedec3f83956bbd73d1b7ee89b9c95a11c3aa3d96597b8b6a9be4"
        );
        assert_eq!(first.status, "filed");
        let again = file_receipt(&mut store, "00", &acme()).unwrap();
        assert_eq!(again.status, "exists");
        assert_eq!(again.id, first.id);
        let got = get_receipt(&store, &first.id).unwrap();
        assert_eq!(got.vendor, "acme supplies");
        assert_eq!(list_receipts(&store).unwrap(), vec![first.id.clone()]);
    }

    #[test]
    fn verify_distinguishes_match_from_tamper() {
        let mut store = MemoryStore::new();
        let filed = file_receipt(&mut store, "00", &acme()).unwrap();
        let ok = verify_receipt(&store, "00", &filed.id, &acme()).unwrap();
        assert_eq!(ok["match"], true);
        let mut tampered = acme();
        tampered.amount = "999.00".into();
        let bad = verify_receipt(&store, "00", &filed.id, &tampered).unwrap();
        assert_eq!(bad["match"], false);
    }
}
