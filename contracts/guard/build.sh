#!/bin/bash
set -e

cd "$(dirname "$0")"
cargo near build --release
