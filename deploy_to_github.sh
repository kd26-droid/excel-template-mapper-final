#!/usr/bin/env bash

set -euo pipefail

# Deploy current workspace to a GitHub repository/branch.
# Interactive deployment script with main branch cleanup option.

REPO_URL="https://github.com/kd26-droid/excel-template-mapper-final.git"

echo "🚀 GitHub Deployment Script"
echo "=========================="
echo ""

# Ask if user wants to create a new branch or deploy to main
echo "Do you want to deploy to a new branch? (y/n)"
read -r USE_NEW_BRANCH

if [[ "$USE_NEW_BRANCH" =~ ^[Yy]$ ]]; then
    echo "Enter the new branch name:"
    read -r BRANCH_NAME
    COMMIT_MSG="deploy: push workspace to ${BRANCH_NAME}"
    FORCE_PUSH=false
else
    BRANCH_NAME="main"
    COMMIT_MSG="deploy: complete workspace deployment to main branch"
    FORCE_PUSH=true
    echo "⚠️  WARNING: This will completely replace all files in the main branch!"
    echo "Do you want to continue? (y/n)"
    read -r CONFIRM_MAIN
    if [[ ! "$CONFIRM_MAIN" =~ ^[Yy]$ ]]; then
        echo "Deployment cancelled."
        exit 0
    fi
fi

echo "Repo URL   : ${REPO_URL}"
echo "Branch     : ${BRANCH_NAME}"
echo "Commit msg : ${COMMIT_MSG}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but not found in PATH" >&2
  exit 1
fi

# Initialize git if needed
if [ ! -d .git ]; then
  echo "Initializing git repository..."
  git init
fi

# Configure default user if not set (use environment overrides if provided)
GIT_NAME="${GIT_AUTHOR_NAME:-${GIT_COMMITTER_NAME:-Codex CI}}"
GIT_EMAIL="${GIT_AUTHOR_EMAIL:-${GIT_COMMITTER_EMAIL:-codex-ci@example.com}}"
git config user.name "${GIT_NAME}"
git config user.email "${GIT_EMAIL}"

# Set or update origin remote
if git remote get-url origin >/dev/null 2>&1; then
  CURRENT_URL="$(git remote get-url origin)"
  if [ "${CURRENT_URL}" != "${REPO_URL}" ]; then
    echo "Updating origin remote from ${CURRENT_URL} -> ${REPO_URL}"
    git remote set-url origin "${REPO_URL}"
  fi
else
  echo "Adding origin remote -> ${REPO_URL}"
  git remote add origin "${REPO_URL}"
fi

# Handle main branch deployment with cleanup
if [[ "$FORCE_PUSH" == true && "$BRANCH_NAME" == "main" ]]; then
  echo "🗑️  Preparing clean deployment to main branch..."

  # Create a temporary branch for current work
  TEMP_BRANCH="temp-deploy-$(date +%s)"
  git checkout -b "${TEMP_BRANCH}"
  git add -A
  git commit -m "temp: staging current workspace" || true

  # Fetch latest from origin to ensure we have the remote main
  echo "Fetching latest from origin..."
  git fetch origin main || echo "No existing main branch on remote"

  # Create/reset main branch to be completely empty
  echo "Creating clean main branch..."
  git checkout --orphan main-new
  git rm -rf . 2>/dev/null || true

  # Copy all current workspace files
  echo "Copying current workspace to clean main..."
  git checkout "${TEMP_BRANCH}" -- . 2>/dev/null || true

  # Check for secrets before staging
  echo "Checking for secrets in files..."
  if grep -r "AZURE_DOCUMENT_INTELLIGENCE_KEY=" . --include="*.yml" --include="*.yaml" --include="*.env" | grep -v "your-azure-form-recognizer-key-here"; then
    echo "⚠️  WARNING: Found potential Azure secrets in files!"
    echo "Please replace real secrets with placeholders before pushing to GitHub."
    echo "Example: AZURE_DOCUMENT_INTELLIGENCE_KEY=your-azure-form-recognizer-key-here"
    exit 1
  fi

  # Stage and commit everything
  git add -A
  git commit -m "${COMMIT_MSG}"

  # Replace main branch
  git branch -D main 2>/dev/null || true
  git branch -m main

  # Force push to replace remote main completely
  echo "🚀 Force pushing clean deployment to main..."
  git push -f origin main

  # Cleanup temp branch
  git branch -D "${TEMP_BRANCH}" 2>/dev/null || true

else
  # Normal branch deployment (new branch or existing branch)
  if git rev-parse --verify "${BRANCH_NAME}" >/dev/null 2>&1; then
    echo "Switching to existing branch ${BRANCH_NAME}"
    git checkout "${BRANCH_NAME}"
  else
    echo "Creating and switching to new branch ${BRANCH_NAME}"
    git checkout -b "${BRANCH_NAME}"
  fi

  # Check for secrets before staging
  echo "Checking for secrets in files..."
  if grep -r "AZURE_DOCUMENT_INTELLIGENCE_KEY=" . --include="*.yml" --include="*.yaml" --include="*.env" | grep -v "your-azure-form-recognizer-key-here"; then
    echo "⚠️  WARNING: Found potential Azure secrets in files!"
    echo "Please replace real secrets with placeholders before pushing to GitHub."
    echo "Example: AZURE_DOCUMENT_INTELLIGENCE_KEY=your-azure-form-recognizer-key-here"
    exit 1
  fi

  # Stage and commit changes
  echo "Staging changes..."
  git add -A

  if git diff --cached --quiet; then
    echo "No changes to commit."
  else
    echo "Committing changes..."
    git commit -m "${COMMIT_MSG}"
  fi

  # Push to GitHub
  echo "Pushing to ${REPO_URL} (${BRANCH_NAME})"
  git push -u origin "${BRANCH_NAME}"
fi

echo "Done."

