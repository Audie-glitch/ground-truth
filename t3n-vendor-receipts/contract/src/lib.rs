//! z-vendor-receipts — hashed vendor invoices in a tenant KV map.
//!
//! Host capabilities: tenant-context, logging, kv-store. No HTTP.

#![warn(clippy::style)]
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

extern crate alloc;

pub const CONTRACT_VERSION: &str = "0.1.0";

pub mod receipt;

wit_bindgen::generate!({
    world: "tenant-receipts",
    path: "wit",
    additional_derives: [serde::Deserialize, serde::Serialize],
    generate_all,
});

struct Component;

#[cfg(target_arch = "wasm32")]
mod host_store {
    use super::host::{
        interfaces::{kv_store, logging},
        tenant::tenant_context,
    };
    use super::receipt::{self, ReceiptInput, ReceiptStore};
    use alloc::format;
    use alloc::string::String;
    use alloc::vec::Vec;

    pub struct HostKv {
        map_name: String,
    }

    impl HostKv {
        pub fn open() -> Self {
            let tid = tenant_context::tenant_did();
            Self {
                map_name: format!("z:{}:receipts", hex::encode(&tid)),
            }
        }

        pub fn tenant_hex() -> String {
            hex::encode(tenant_context::tenant_did())
        }
    }

    impl ReceiptStore for HostKv {
        fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>, String> {
            kv_store::get(&self.map_name, key).map_err(|e| format!("kv read: {e}"))
        }

        fn put(&mut self, key: &[u8], value: &[u8]) -> Result<(), String> {
            kv_store::put(&self.map_name, key, value).map_err(|e| format!("kv write: {e}"))
        }
    }

    fn input_bytes(input: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
        Ok(input.unwrap_or_default())
    }

    pub fn file_receipt(input: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
        let req: ReceiptInput = serde_json::from_slice(&input_bytes(input)?)
            .map_err(|e| format!("file-receipt: bad input: {e}"))?;
        let mut store = HostKv::open();
        let filed = receipt::file_receipt(&mut store, &HostKv::tenant_hex(), &req)?;
        let _ = logging::info(&format!("filed receipt {}", filed.id));
        serde_json::to_vec(&filed).map_err(|e| e.to_string())
    }

    pub fn get_receipt(input: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
        #[derive(serde::Deserialize)]
        struct GetReq {
            id: String,
        }
        let req: GetReq = serde_json::from_slice(&input_bytes(input)?)
            .map_err(|e| format!("get-receipt: bad input: {e}"))?;
        let store = HostKv::open();
        let filed = receipt::get_receipt(&store, &req.id)?;
        serde_json::to_vec(&filed).map_err(|e| e.to_string())
    }

    pub fn list_receipts() -> Result<Vec<u8>, String> {
        let store = HostKv::open();
        let ids = receipt::list_receipts(&store)?;
        serde_json::to_vec(&serde_json::json!({ "ids": ids })).map_err(|e| e.to_string())
    }

    pub fn verify_receipt(input: Option<Vec<u8>>) -> Result<Vec<u8>, String> {
        #[derive(serde::Deserialize)]
        struct VerifyReq {
            id: String,
            vendor: String,
            invoice_id: String,
            amount: String,
            currency: String,
            issued_at: String,
        }
        let req: VerifyReq = serde_json::from_slice(&input_bytes(input)?)
            .map_err(|e| format!("verify-receipt: bad input: {e}"))?;
        let claimed = ReceiptInput {
            vendor: req.vendor,
            invoice_id: req.invoice_id,
            amount: req.amount,
            currency: req.currency,
            issued_at: req.issued_at,
        };
        let store = HostKv::open();
        let result = receipt::verify_receipt(&store, &HostKv::tenant_hex(), &req.id, &claimed)?;
        if result["match"] == false {
            let _ = logging::error("verify-receipt: hash mismatch");
        }
        serde_json::to_vec(&result).map_err(|e| e.to_string())
    }
}

#[cfg(target_arch = "wasm32")]
impl exports::z::vendor_receipts::contracts::Guest for Component {
    fn file_receipt(
        req: exports::z::vendor_receipts::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        host_store::file_receipt(req.input)
    }

    fn get_receipt(
        req: exports::z::vendor_receipts::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        host_store::get_receipt(req.input)
    }

    fn list_receipts(
        _req: exports::z::vendor_receipts::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        host_store::list_receipts()
    }

    fn verify_receipt(
        req: exports::z::vendor_receipts::contracts::GenericInput,
    ) -> Result<alloc::vec::Vec<u8>, alloc::string::String> {
        host_store::verify_receipt(req.input)
    }
}

#[cfg(target_arch = "wasm32")]
export!(Component);

#[cfg(test)]
mod tests {
    use super::CONTRACT_VERSION;

    #[test]
    fn contract_version_is_semver() {
        let parts: Vec<&str> = CONTRACT_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3);
        for part in parts {
            assert!(part.parse::<u32>().is_ok());
        }
    }
}
