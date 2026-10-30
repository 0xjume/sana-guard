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

# Build with cargo-near if available, otherwise use wasm-opt
if command -v cargo-near &> /dev/null; then
    echo "Using cargo-near build..."
    cargo near build --release
    WASM_FILE="target/near/sana_guard_contract/sana_guard_contract.wasm"
else
    echo "Using cargo build + wasm-opt..."
    cargo build --target wasm32-unknown-unknown --release
    
    # Optimize with wasm-opt
    if command -v wasm-opt &> /dev/null; then
        wasm-opt -Oz --strip-debug \
            ../../target/wasm32-unknown-unknown/release/sana_guard_contract.wasm \
            -o ../../target/wasm32-unknown-unknown/release/sana_guard_contract_opt.wasm
        WASM_FILE="../../target/wasm32-unknown-unknown/release/sana_guard_contract_opt.wasm"
    else
        echo "Warning: wasm-opt not found, deploying unoptimized binary"
        WASM_FILE="../../target/wasm32-unknown-unknown/release/sana_guard_contract.wasm"
    fi
fi

cd ../..

WASM_SIZE=$(stat -f%z "$WASM_FILE" 2>/dev/null || stat -c%s "$WASM_FILE")
echo "WASM size: $((WASM_SIZE / 1024)) KB"

if [ $WASM_SIZE -gt 419430 ]; then
    echo "Warning: WASM file is larger than 409 KB ($((WASM_SIZE / 1024)) KB)"
fi

echo "Deploying to $CONTRACT_ACCOUNT..."
near deploy "$CONTRACT_ACCOUNT" "$WASM_FILE"

echo "Initializing contract..."
near call "$CONTRACT_ACCOUNT" new \
    "{\"mpc_contract\": \"$MPC_CONTRACT\", \"mpc_domain_id\": $MPC_DOMAIN_ID, \"network_tag\": \"$NETWORK_TAG\", \"admin\": \"$NEAR_ADMIN_ACCOUNT\"}" \
    --accountId "$NEAR_OWNER_ACCOUNT"

echo "Deployment complete!"
echo "Contract: $CONTRACT_ACCOUNT"
echo "MPC Contract: $MPC_CONTRACT"
echo "MPC Domain ID: $MPC_DOMAIN_ID"
echo "Network Tag: $NETWORK_TAG"
echo "Admin: $NEAR_ADMIN_ACCOUNT"
