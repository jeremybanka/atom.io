# atom.io.fyi

The documentation website is a private workspace package released through
Changesets and deployed to Cloudflare Workers.

## Releases

Include a changeset targeting `atom.io.fyi` for website changes. Changesets updates
its version and changelog in the usual release PR. Merging that PR lets
`changeset publish` create the site's version tag while keeping it off npm.

The Deploy Site workflow runs when a stable `atom.io.fyi@*` tag is created. It
builds the tagged commit and its workspace dependencies, then runs the site's
existing Wrangler deployment script. Branch pushes, other package tags, and
prerelease tags do not deploy production.

Changesets uses the existing GitHub App token to push release tags so they can
trigger Deploy Site. Keep that token: tags pushed with the default `GITHUB_TOKEN`
do not trigger another workflow.

## Main preview

Cloudflare Workers Builds continuously builds `main` and runs the site's
`deploy:preview` script from [package.json](./package.json). The script uploads a
Worker version with the fixed alias `main`, whose stable URL follows the latest
successful main build. Other branches do not trigger preview deployments.
Production continues to deploy through Changesets release tags.

Version preview URLs are enabled in [wrangler.jsonc](./wrangler.jsonc). This keeps
the existing
[aliased version URL model](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/#aliased-version-urls):
the preview runs the uploaded version with its production resource bindings, and
uploading a version does not change production traffic. The stable URL uses the
form `main-atom-io-fyi.<workers-subdomain>.workers.dev` and is returned by Wrangler
after the first upload.

## Agent handoff for production setup

Use an agent authenticated to both GitHub and Cloudflare to configure the release
credentials, stop automatic production deployments, and configure the main
preview. Prepare and verify the credentials before changing the existing
deployment path. The workflow is
introduced by [PR #1488](https://github.com/jeremybanka/atom.io/pull/1488); setup can
finish before that PR merges, with live release verification pending afterward.

| Target              | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| GitHub repository   | `jeremybanka/atom.io`                                      |
| GitHub environment  | `atom.io.fyi`                                              |
| Deployment workflow | [deploy-site.yml](../../.github/workflows/deploy-site.yml) |
| Existing Worker     | `atom-io-fyi`, from [wrangler.jsonc](./wrangler.jsonc)     |
| Production website  | [atom.io.fyi](https://atom.io.fyi)                         |
| Continuous preview  | Version alias `main`, built only from `main`               |
| Account variable    | `CLOUDFLARE_ACCOUNT_ID`                                    |
| Deployment secret   | `CLOUDFLARE_API_TOKEN`                                     |

### 1. Inspect the existing configuration

Find the Cloudflare account containing `atom-io-fyi` and verify that its custom
domain or route serves `atom.io.fyi`. Record the account ID, active deployment
and version IDs, Git source, production branch, build root and commands, and
whether preview builds are enabled. Save configuration metadata needed to restore
the build settings; omit secret values. Keep the existing Worker, hostname,
bindings, and active deployment in place.

On GitHub, read the deployment workflow and the existing `atom.io.fyi` environment
before updating either. Confirm the authenticated identity can manage that
environment. Fine-grained tokens need Administration write to create an
[environment](https://docs.github.com/en/rest/deployments/environments#create-or-update-an-environment)
and Environments write to manage its
[secrets](https://docs.github.com/en/rest/actions/secrets#create-or-update-an-environment-secret)
and
[variables](https://docs.github.com/en/rest/actions/variables#create-an-environment-variable).
A successful repository read does not establish these permissions.

### 2. Configure the deployment credentials

Reuse an existing dedicated CI token only when its value is available securely
and its scope is appropriate. Otherwise create a token named
`atom.io.fyi GitHub Actions` using Cloudflare's Edit Cloudflare Workers template.
Limit its resources to the owning account and the permissions needed by the
existing deployment, including Workers Scripts Edit. Review any additional
template permissions against the Worker's actual bindings and configuration.
Keep the agent's broader setup credentials separate from this CI token. Follow
[Cloudflare's GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

Verify the deployment token is active using the verification endpoint appropriate
to its token type, then use it to read the intended Worker in the intended account.
Check its policy and expiry when creating or inspecting it; token verification
alone does not establish deployment permissions.

Create the `atom.io.fyi` GitHub environment if absent. Preserve existing protection
rules and ensure its deployment branch/tag policy permits `atom.io.fyi@*` tags;
a policy permitting only the `main` branch will block this workflow.

Set `CLOUDFLARE_ACCOUNT_ID` as an environment **variable** and
`CLOUDFLARE_API_TOKEN` as an environment **secret**. Prefer this environment scope
to changing repository-wide credentials. Reuse matching existing configuration
where possible; GitHub cannot return a stored secret's plaintext for comparison.

Use the authenticated GitHub integration or GitHub CLI to store the secret. With
the CLI, target repository `jeremybanka/atom.io` and environment `atom.io.fyi`, and
pass the token through standard input to
[secret set](https://cli.github.com/manual/gh_secret_set). This handles encryption
before upload. Set the account ID with
[variable set](https://cli.github.com/manual/gh_variable_set). Keep token values
out of tool output, command arguments, files in the checkout, and the handoff report.

Read back the account variable and the secret's name and update timestamp. Resolve
permission or credential-write failures before proceeding to cutover.

### 3. Configure the continuous main preview

Keep this Worker's Git build integration connected to `jeremybanka/atom.io`. Under
Workers & Pages > `atom-io-fyi` > Settings > Builds, select `main` as the production
branch and change its **deploy command** to run the site's `deploy:preview` package
script. Preserve the build command, build root, and pnpm workspace selection.
Cloudflare calls this the production branch, but its deploy command now updates
only the fixed `main` version alias. The GitHub release workflow handles production.

If the package script has not reached `main` yet, keep the existing version-upload
command and add the `--preview-alias` option with value `main`. This establishes
the same alias before the PR merges. Switch to the package script once available.

Under Branch control, disable **Enable Preview Builds** (or the legacy
**Builds for non-production branches** setting). This stops pushes to other
branches from creating or updating previews; the main-branch build remains
enabled. This control governs automatic branch builds, not routing to the fixed
`main` version preview URL. See Cloudflare's
[branch controls](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

Run a Cloudflare build of `main` to establish the preview URL. Use a deploy command
available at that commit; older commits do not contain the new package script.
Check that the upload completes using the existing build token, and record the
stable alias URL returned by Wrangler. Keep the existing version-upload model
when disabling branch builds.

For API-based changes, follow the current
[Builds API reference](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).
It identifies the Worker by its immutable script tag, obtained from the Workers
Scripts API, rather than its name. The Builds API requires a user-scoped token
with Workers Builds Configuration Edit; this is a setup permission, not a CI
deployment requirement. Read settings first, set `git_repository.branch` to
`main`, set `production_settings.deploy_command` to run the site's preview script,
and set `previews_enabled` to `false`. If existing per-branch Preview build records
still have `auto_build` enabled, disable it on those records too.

After saving, read the settings back and inspect queued or running production
builds. Cancel builds still using the old production deploy command and queued or
running non-main preview builds. Confirm that only main pushes can deploy a
preview and no Git build command can change the production deployment.

### 4. Verify and report the handoff

Confirm the account variable matches the verified Worker account, the deployment
secret exists, and environment policies admit the workflow's release tags. Read
Cloudflare settings again to confirm that `main` builds run the preview script and
non-production branch builds are disabled. Check that the active production
deployment and hostname routing remain as recorded and that the homepage and a
documentation page still respond successfully.

After changing the Cloudflare command, verify the main build succeeds, the
stable main alias serves the built commit, and a homepage and documentation page
respond there too. Check that later main builds update the same alias and that
other branches no longer schedule builds. Existing historical preview URLs may
remain available; disabling their build triggers does not delete deployments.

Preparing the settings does not require creating a test release tag, publishing
packages, or deploying production. Token checks and Wrangler dry runs do not
prove a live GitHub-to-Cloudflare production deployment. Report main-preview
verification separately from production verification, which occurs with the next
normal Changesets site release. That release should produce a successful Deploy
Site run and a Cloudflare deployment from the tagged commit.

Return the GitHub environment link, the variable/secret names and verification
status, the Cloudflare account and Worker identifiers, the token ID/name and expiry
when available, the main preview URL and uploaded version ID, the branch-build setting,
and any builds canceled. Include the active production deployment IDs before and
after setup, website checks, and whether the main preview and first Changesets
deployment are verified or still pending. Include remaining blockers and their
exact missing permissions, without credential values.

To retry a failed release deployment, re-run the failed Deploy Site job in GitHub
Actions. It uses the original tagged commit without rerunning npm publication.
Deployment status is recorded in the `atom.io.fyi` GitHub environment; a release
tag identifies the version requested for deployment.
