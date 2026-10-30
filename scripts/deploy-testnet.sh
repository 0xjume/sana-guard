#!/bin/bash
set -e

# Deploy Sana Guard contract to testnet
# Usage: 
#   export NEAR_OWNER_ACCOUNT=your-account.testnet
#   export NEAR_ADMIN_ACCOUNT=your-account.testnet
#   ./scripts/deploy-testnet.sh

CONTRACT_ACCOUNT="${CONTRACT_ACCOUNT:-guard.djume.testnet}"
NEAR_OWNER_ACCOUNT="${NEAR_OWNER_ACCOUNT:-djume.testnet}"
NEAR_ADMIN_ACCOUNT="${NEAR_ADMIN_ACCOUNT:-djume.testnet}"
MPC_CONTRACT="${MPC_CONTRACT:-v1.signer-prod.testnet}"
MPC_DOMAIN_ID="${MPC_DOMAIN_ID:-1}"
NETWORK_TAG="${NETWORK_TAG:-near-testnet}"

echo "Building contract..."
cd contracts/guard

# Build with cargo-near
echo "Using cargo-near build..."
cargo near build non-reproducible-wasm --no-abi
WASM_FILE="target/near/sana_guard_contract.wasm"

cd ../..

WASM_SIZE=$(stat -f%z "$WASM_FILE" 2>/dev/null || stat -c%s "$WASM_FILE")
echo "WASM size: $((WASM_SIZE / 1024)) KB"

if [ $WASM_SIZE -gt 419430 ]; then
    echo "Warning: WASM file is larger than 409 KB ($((WASM_SIZE / 1024)) KB)"
fi

# Calculate required storage deposit (1 NEAR per 100 KB)
STORAGE_BYTES=$WASM_SIZE
STORAGE_NEAR=$(echo "scale=2; $STORAGE_BYTES / 100000 + 0.5" | bc)
echo "Estimated storage cost: ${STORAGE_NEAR} NEAR"

# Check current balance and storage
echo "Checking contract account balance..."
CURRENT_BALANCE=$(near account view-account-summary "$CONTRACT_ACCOUNT" network-config testnet 2>/dev/null | grep "Balance" | awk '{print $2}' || echo "0")

echo "Current balance: ${CURRENT_BALANCE}"
echo ""
echo "Note: Ensure the contract account has at least ${STORAGE_NEAR} NEAR available for storage."
echo "If needed, transfer NEAR to $CONTRACT_ACCOUNT before deploying."
echo ""

echo "Deploying to $CONTRACT_ACCOUNT..."
near contract deploy "$CONTRACT_ACCOUNT" \
    use-file "$WASM_FILE" \
    with-init-call new \
    json-args "{\"mpc_contract\": \"$MPC_CONTRACT\", \"mpc_domain_id\": $MPC_DOMAIN_ID, \"network_tag\": \"$NETWORK_TAG\", \"admin\": \"$NEAR_ADMIN_ACCOUNT\"}" \
    prepaid-gas '100.0 Tgas' \
    attached-deposit '0 NEAR' \
    network-config testnet \
    sign-with-keychain \
    send

echo ""
echo "Deployment complete!"
echo "Contract: $CONTRACT_ACCOUNT"
echo "MPC Contract: $MPC_CONTRACT"
echo "MPC Domain ID: $MPC_DOMAIN_ID"
echo "Network Tag: $NETWORK_TAG"
echo "Admin: $NEAR_ADMIN_ACCOUNT"
