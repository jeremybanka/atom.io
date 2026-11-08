# atom.io.fyi

The documentation website is a private workspace package released through
Changesets and deployed to Cloudflare Workers. GitHub Actions builds the site and
its workspace dependencies with the versions pinned in [mise.toml](../../mise.toml),
then uploads the finished output with Wrangler. Cloudflare Builds is disconnected.

## Releases

Include a changeset targeting `atom.io.fyi` for website changes. Changesets updates
its version and changelog in the usual release PR. Merging that PR lets
`changeset publish` create the site's version tag while keeping it off npm.

The production path of the Deploy Site workflow runs when a stable
`atom.io.fyi@*` tag is created. It builds the tagged commit and its workspace
dependencies, then runs the site's
existing Wrangler deployment script. Branch pushes, other package tags, and
prerelease tags do not deploy production.

Changesets uses the existing GitHub App token to push release tags so they can
trigger Deploy Site. Keep that token: tags pushed with the default `GITHUB_TOKEN`
do not trigger another workflow.

## Main preview

The Deploy Site workflow also runs on pushes to `main`. It builds in GitHub
Actions using the same pinned tools as releases, then runs the site's
`deploy:preview` script from [package.json](./package.json). The script uploads a
Worker version with the fixed alias `main`, whose stable URL follows the latest
successful main build. Other branches do not trigger preview deployments.
Production continues to deploy through Changesets release tags.

Both paths use the prepared `atom.io.fyi` GitHub environment. Its deployment
records link to the relevant production or preview URL. PRs still run the normal
CI checks, with no Cloudflare build or deployment.

Version preview URLs are enabled in [wrangler.jsonc](./wrangler.jsonc). This keeps
the existing
[aliased version URL model](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/#aliased-version-urls):
the preview runs the uploaded version with its production resource bindings, and
uploading a version does not change production traffic. The stable URL uses the
form `main-atom-io-fyi.<workers-subdomain>.workers.dev` and is returned by Wrangler
after the first upload.

## Agent handoff for production setup

Use an agent authenticated to both GitHub and Cloudflare to configure the release
credentials and move every site build into GitHub Actions. Prepare and verify the
credentials before disconnecting Cloudflare Builds. The stable main preview
and production site keep serving their existing versions during setup. The workflow
is introduced by [PR #1488](https://github.com/jeremybanka/atom.io/pull/1488); setup can
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
rules and ensure its deployment policy permits the `main` **branch** and
`atom.io.fyi@*` **tags**. The main branch needs access to the existing upload
credentials for previews; the tags need it for production releases. Keep branch
and tag rules distinct and preserve any existing tag allow rule. See GitHub's
[environment deployment policies](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

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

### 3. Retire the Cloudflare build requirement

Retire the matching GitHub PR check requirement as part of the migration. Inspect
all rulesets and classic branch protections applying to `main` for
`Workers Builds: atom-io-fyi`. With explicit repository-owner approval, remove
only that obsolete required check, preserving every other check and protection.
Otherwise future PRs can wait indefinitely for a branch-preview check that no
longer runs. Read the effective rules back to verify the exact change.

### 4. Disconnect Cloudflare Builds

Under Workers & Pages > `atom-io-fyi` > Settings > Builds, disconnect this Worker's
Git build integration. This stops Cloudflare from building every branch, including
`main`. GitHub Actions builds the site and uploads its assets and Worker bundle
directly; no Cloudflare build image or Node installation is involved. Follow
Cloudflare's
[disconnect instructions](https://developers.cloudflare.com/workers/ci-cd/builds/#disconnecting-builds).

Keep the Worker, its versions and aliases, hostname routing, bindings, and the
account-wide Cloudflare GitHub App installation in place. Inspect queued or
running builds for this Worker and cancel them if present. Read the saved build
settings back and confirm the Worker no longer has a Git build trigger. Do not run
a Cloudflare build to verify this migration.

### 5. Verify and report the handoff

Confirm the account variable matches the verified Worker account, the deployment
secret exists, and environment policies admit both `main` and the site's release
tags. Read Cloudflare settings again to confirm the Git build integration is
disconnected. Check that the active production deployment and hostname routing
remain as recorded and that the homepage and a
documentation page still respond successfully.

Once the workflow reaches `main`, verify its GitHub Actions build succeeds, the
stable main alias serves the built commit, and a homepage and documentation page
respond there too. Check that later main builds update the same alias and that
no branch schedules a Cloudflare build. Existing historical preview URLs may
remain available; disabling their build triggers does not delete deployments.
Completed Cloudflare checks and bot comments also remain on existing PRs. Compare
their completion times with the cutover time when checking for new deployments.
Confirm GitHub no longer requires the retired Cloudflare branch-preview check.

Preparing the settings does not require creating a test release tag, publishing
packages, or deploying production. The existing preview remains available while
the workflow awaits merge. Token checks and Wrangler dry runs do not prove a live
GitHub-to-Cloudflare deployment. Report preview verification from GitHub Actions
separately from production verification, which occurs with the next normal
Changesets site release. That release should produce a successful Deploy Site run
and a Cloudflare deployment from the tagged commit.

Return the GitHub environment link, the variable/secret names and verification
status, the Cloudflare account and Worker identifiers, the token ID/name and expiry
when available, the main preview URL and uploaded version ID, the disconnected
build-integration state, the retained required checks and environment policies,
and any builds canceled. Include the active production deployment IDs before and
after setup, website checks, and whether the main preview and first Changesets
deployment are verified or still pending. Include remaining blockers and their
exact missing permissions, without credential values.

To retry a failed release deployment, re-run the failed Deploy Site job in GitHub
Actions. It uses the original tagged commit without rerunning npm publication.
Deployment status is recorded in the `atom.io.fyi` GitHub environment; a release
tag identifies the version requested for deployment.
