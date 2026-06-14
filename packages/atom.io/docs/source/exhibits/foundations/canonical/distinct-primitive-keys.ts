import { packCanonical } from "atom.io/foundations/canonical"

packCanonical(`null`) !== packCanonical(null)
packCanonical(`1`) !== packCanonical(1)
packCanonical(true) !== packCanonical(1)
