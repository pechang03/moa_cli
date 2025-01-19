# MOA CLI

A command-line interface tool for chaining multiple AI models together to process prompts sequentially.

## Description

MOA CLI is a flexible tool that enables users to create chains of AI model interactions, allowing you to leverage different AI models (like OpenAI's GPT and Ollama's models) in sequence for more complex processing tasks.

## Research Background & Methodology

This tool is an implementation based on the Mixture-of-Agents (MoA) methodology described in:

> Liu, S., Wang, W., Dai, Y., Li, C., Zhou, J., & Lee, H. (2023). "Mixture of Artificial and Human Agents for Multi-Step Reasoning." _ArXiv:2310.13227 [Cs.AI]_. [https://arxiv.org/abs/2310.13227](https://arxiv.org/abs/2310.13227)

The MoA approach combines multiple AI models in a sequential chain, where each model processes and refines the output of the previous model. The research demonstrates that this methodology can:

- Leverage the unique strengths of different language models
- Produce more reliable and higher quality outputs through iterative refinement
- Enable complex reasoning tasks through decomposition and specialized processing

This CLI tool provides an open-source implementation inspired by these research findings, allowing users to experiment with different model combinations and chain configurations.

## Implementation Features

Our implementation includes several key features to enhance stability and effectiveness:

### Question Preservation

- The original question/prompt is preserved and passed through the entire chain
- This approach improves stability by ensuring each model maintains context with the original task
- Helps prevent drift and maintain focus on the initial objective throughout the chain

### XML-Based Prompt Formatting

- Implements structured prompt formatting using XML tags, following the methodology demonstrated by Jordan Disler (2023)
- Enables clear separation of different prompt components (context, instructions, examples)
- Improves model response consistency and reliability
- Reference: Disler, J. (2023). "ChatGPT / GPT XML Prompt Pattern." [GitHub Gist](https://gist.github.com/disler/7798d826102091649824adfd05c55080)

## Installation

1. Make sure you have [Bun](https://bun.sh/) installed on your system
2. Clone this repository
3. Install dependencies:

```bash
bun install
```

## Usage

Run the CLI with the following syntax:

```bash
bun run moa_chain.ts "<prompt_files>" "<model_chain>" <iterations>
```

Example:

```bash
bun run moa_chain.ts "prompt1.txt,prompt2.txt" "ollama:model1,openai:gpt-4" 3
```

- `prompt_files`: Comma-separated list of prompt template files
- `model_chain`: Comma-separated list of AI models to use in sequence
- `iterations`: Number of times to run the chain

## License

This project is licensed under the MIT License. See the LICENSE file for details.

### Acknowledgments

- This implementation is based on the MoA methodology research by Liu et al. (2023)
- XML prompt formatting approach adapted from Jordan Disler's work (2023)
