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

## Deployment setup

Configure the `atom.io.fyi` GitHub environment with a `CLOUDFLARE_ACCOUNT_ID`
variable and a `CLOUDFLARE_API_TOKEN` secret. Use a Cloudflare API token with the
permissions needed to deploy the existing `atom-io-fyi` Worker, scoped to its
account. Repository-level variables and secrets are also supported.

Disconnect the Worker's Git integration under Settings > Builds to stop automatic
production deployments. To retain preview builds, keep the integration and
[configure production builds to upload versions without deploying](https://developers.cloudflare.com/workers/ci-cd/builds/#disconnecting-builds).

To retry a failed deployment, re-run the failed Deploy Site job in GitHub Actions.
It uses the original tagged commit without rerunning npm publication. Deployment
status is recorded in the `atom.io.fyi` GitHub environment; a release tag identifies
the version requested for deployment.
