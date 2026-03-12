# Hyperbolic Demo

[![GitHub Super-Linter](https://github.com/rjlacanlaled/hyperbolic-demo/actions/workflows/linter.yml/badge.svg)](https://github.com/super-linter/super-linter)
![CI](https://github.com/rjlacanlaled/hyperbolic-demo/actions/workflows/ci.yml/badge.svg)

## Usage

Here's an example of how to use this action in a workflow file:

```yaml
name: Example Workflow

on:
  workflow_dispatch:
    inputs:
      who-to-greet:
        description: Who to greet in the log
        required: true
        default: 'World'
        type: string

jobs:
  say-hello:
    name: Say Hello
    runs-on: ubuntu-latest

    steps:
      # Change @main to a specific commit SHA or version tag, e.g.:
      # rjlacanlaled/hyperbolic-demo@e76147da8e5c81eaf017dede5645551d4b94427b
      # rjlacanlaled/hyperbolic-demo@v1.2.3
      - name: Print to Log
        id: print-to-log
        uses: rjlacanlaled/hyperbolic-demo@main
        with:
          who-to-greet: ${{ inputs.who-to-greet }}
```

For example workflow runs, check out the
[Actions tab](https://github.com/rjlacanlaled/hyperbolic-demo/actions)!

## Inputs

| Input          | Default | Description                     |
| -------------- | ------- | ------------------------------- |
| `who-to-greet` | `World` | The name of the person to greet |

## Outputs

| Output | Description             |
| ------ | ----------------------- |
| `time` | The time we greeted you |
