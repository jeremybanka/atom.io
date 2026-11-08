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

## Agent handoff for production setup

Use an agent authenticated to both GitHub and Cloudflare to configure the release
credentials and stop automatic production deployments. Prepare and verify the
credentials before changing the existing deployment path. The workflow is
introduced by [PR #1488](https://github.com/jeremybanka/atom.io/pull/1488); setup can
finish before that PR merges, with live release verification pending afterward.

| Target              | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| GitHub repository   | `jeremybanka/atom.io`                                      |
| GitHub environment  | `atom.io.fyi`                                              |
| Deployment workflow | [deploy-site.yml](../../.github/workflows/deploy-site.yml) |
| Existing Worker     | `atom-io-fyi`, from [wrangler.jsonc](./wrangler.jsonc)     |
| Production website  | [atom.io.fyi](https://atom.io.fyi)                         |
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

### 3. Stop automatic production deployments

Change only this Worker's build integration. If preview builds are enabled,
preserve them and change the **production deploy command** to Wrangler's
version-upload operation. Use the installed workspace Wrangler and retain the
existing build root and monorepo package selection. The command must upload a
version without promoting it to the active deployment; check any wrapper script
or chained command for a subsequent deployment. Leave the build command and
preview configuration intact. Cloudflare documents this
[version-upload cutover](https://developers.cloudflare.com/workers/ci-cd/builds/#disconnecting-builds).

If previews are unused, disconnect the repository from this Worker under
Workers & Pages > `atom-io-fyi` > Settings > Builds > Disconnect. This removes the
Worker's automatic build path while retaining its running deployment. Keep the
account's Cloudflare GitHub App installation available to other projects.

For API-based changes, follow the current
[Builds API reference](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/).
It identifies the Worker by its immutable script tag, obtained from the Workers
Scripts API, rather than its name. The Builds API requires a user-scoped token
with Workers Builds Configuration Edit; this is a setup permission, not a CI
deployment requirement. Read settings first and patch only
`production_settings.deploy_command` when preserving previews.

After saving, read the settings back and inspect queued or running production
builds. Cancel builds still using the old deploy command so they cannot promote
a version after cutover. Confirm there is no remaining push-triggered path that
can change this Worker's active deployment.

### 4. Verify and report the handoff

Confirm the account variable matches the verified Worker account, the deployment
secret exists, and environment policies admit the workflow's release tags. Read
Cloudflare settings again to confirm the Git integration is disconnected or its
production command only uploads versions. Check that the active deployment and
hostname routing remain as recorded and that the homepage and a documentation
page still respond successfully.

This setup does not require merging a PR, creating a test release tag, publishing
packages, or deploying production. Token checks and Wrangler dry runs do not
prove a live GitHub-to-Cloudflare deployment. Report setup readiness separately
from end-to-end verification, which occurs with the next normal Changesets site
release. That release should produce a successful Deploy Site run and a
Cloudflare deployment from the tagged commit.

Return the GitHub environment link, the variable/secret names and verification
status, the Cloudflare account and Worker identifiers, the token ID/name and expiry
when available, the chosen cutover mode, preview status, and any builds canceled.
Include the active deployment IDs before and after setup, website checks, and
whether the first Changesets deployment is verified or still pending. Include
remaining blockers and their exact missing permissions, without credential values.

To retry a failed release deployment, re-run the failed Deploy Site job in GitHub
Actions. It uses the original tagged commit without rerunning npm publication.
Deployment status is recorded in the `atom.io.fyi` GitHub environment; a release
tag identifies the version requested for deployment.
