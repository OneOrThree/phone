#!/bin/sh

set -e

# Install Node.js
brew install node

# Install npm packages
cd "$CI_PRIMARY_REPOSITORY_PATH/app"
npm install

# Install CocoaPods dependencies
cd ios
pod install
