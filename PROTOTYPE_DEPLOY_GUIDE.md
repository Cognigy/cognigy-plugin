# Deploying this prototype

This repo is enrolled in the **prototype automation pipeline**. Push to `main` and everything below happens automatically. This guide walks through what to expect and how to customise.

## Prerequisites

- This repo has the GitHub topic `prototype`
- The files below were synced automatically from the [prototype-automation](https://github.com/Cognigy/prototype-automation) repo:
  - `.github/workflows/prototype-deploy.yml` — CI workflow (build, push, fleet PR)
  - `.cursor/skills/prototype-dockerfile/SKILL.md` — Cursor AI skill for generating a Dockerfile
  - This file (`PROTOTYPE_DEPLOY_GUIDE.md`)

## Step 1 — Create a Dockerfile

A `Dockerfile` at the repo root is **optional**. If you don't provide one, the workflow auto-detects your stack (Node.js, React, Python, Go, or static) and generates one at build time.

For more control — especially for full-stack apps — use the **Cursor skill** that was synced into this repo:

1. Open this repo in **Cursor**.
2. The skill at `.cursor/skills/prototype-dockerfile/SKILL.md` is automatically available.
3. Ask Cursor to generate a Dockerfile for your project. The skill understands the pipeline constraints (single container, single port, relative asset paths).
4. Review and commit the generated `Dockerfile`.

## Step 2 — Configure port and metadata (optional)

Create `.prototype-meta.toml` at the repo root:

```toml
display_name = "My Prototype"
summary = "Short description of what this does."
team = "Your Team"
tags = ["tag1", "tag2"]
port = 3000
```

The `port` field sets the container port. If omitted, the pipeline uses the `EXPOSE` directive from your Dockerfile, or defaults to `3000`.

## Step 3 — Push to main

```bash
git add .
git commit -m "feat: initial prototype"
git push origin main
```

The workflow runs automatically and does the following:

1. **Builds** a Docker image from your Dockerfile (or auto-generates one).
2. **Pushes** the image to Azure Container Registry with tags `latest`, short SHA, full SHA, and `0.0.N` (semver).
3. **Opens a PR** to the fleet repo with all Kubernetes manifests (first deploy only):
   - `https://cognigy.visualstudio.com/Cognigy.AI/_git/flux-fleet-non-prod`
4. **Generates BasicAuth credentials** (username: `cognigy`, password: random 32-char) and prints them in the **GitHub Actions step summary**.

## Step 4 — Save your credentials

After the first successful build, go to **Actions → Prototype Deploy → your run → Summary**. You will see:

- **BasicAuth username**: `cognigy`
- **BasicAuth password**: a random 32-character string

**Save these credentials.** They are generated once and only shown in the step summary. You will need them to access your prototype at its URL.

If you lose them, they can be recovered from the fleet repo (see the [prototype-automation README](https://github.com/Cognigy/prototype-automation#finding-credentials-for-an-existing-prototype)).

## Step 5 — Merge the fleet PR

The workflow creates a PR in the fleet repo:

- `https://cognigy.visualstudio.com/Cognigy.AI/_git/flux-fleet-non-prod`

The PR adds Kubernetes manifests for your prototype (Namespace, Deployment, Service, Ingress, BasicAuth middleware, image automation). Once merged, **FluxCD** deploys your prototype to the cluster.

## Step 6 — Access your prototype

After the fleet PR is merged and FluxCD reconciles (usually within minutes):

- **URL**: `https://prototypes.cognigy.ai/{repo-name}/`
- **Auth**: use the BasicAuth credentials from step 4

## Subsequent pushes

After the first deploy, you don't need to do anything special. Just push to `main`:

1. The workflow builds and pushes a new image with an incremented semver tag (`0.0.N`).
2. FluxCD image automation detects the new tag and updates the Deployment automatically.
3. No new fleet PR is created — the existing manifests handle it.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Workflow says "prototype topic missing" | Add the topic `prototype` to this repo under Settings → Topics |
| Dockerfile generation fails | Add a `Dockerfile` manually, or use the Cursor skill |
| Fleet PR not created | Check the workflow summary for errors. Ensure `AZURE_DEVOPS_PAT` is valid. |
| Prototype not accessible after merge | Wait a few minutes for FluxCD to reconcile. Check pod status in the cluster. |
| Forgot BasicAuth password | Decode from the fleet repo — see [instructions](https://github.com/Cognigy/prototype-automation#finding-credentials-for-an-existing-prototype) |
| Wrong port / app not responding | Set `port` in `.prototype-meta.toml` to match the port your app listens on |
