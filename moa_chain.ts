import { execSync } from "child_process";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

// Read configurations from .env
const OLLAMA_BASE_API1 = process.env.OLLAMA_BASE_API1 || "ollama"; // Default to 'ollama' if not set
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // Assuming you may use OpenAI API

// Function to call a model
const runModel = (model: string, prompt: string, apiBase: string): string => {
  const command = `${apiBase} run ${model} --input "${prompt}"`; // Example using a model API
  try {
    return execSync(command, { encoding: "utf-8" });
  } catch (error) {
    console.error(`Error running model ${model}:`, error);
    process.exit(1);
  }
};

// MOA Join Function: How outputs are merged/joined
const moaJoin = (
  outputs: string[],
  method: "concatenate" | "average" | "weighted" = "concatenate",
): string => {
  switch (method) {
    case "concatenate":
      return outputs.join("\n"); // Concatenate all outputs with newline
    case "average":
      // Assuming numerical outputs or embeddings, this could be averaged
      const numericalOutputs = outputs
        .map((output) => parseFloat(output.trim()))
        .filter((val) => !isNaN(val));
      if (numericalOutputs.length === 0) return outputs.join("\n");
      const avg =
        numericalOutputs.reduce((acc, val) => acc + val, 0) /
        numericalOutputs.length;
      return avg.toString();
    case "weighted":
      // Example: simple weighted average of outputs (could be extended with custom weights)
      const weights = [0.5, 0.5]; // Example weights for 2 models
      const weightedAvg = outputs.reduce(
        (acc, output, idx) => acc + parseFloat(output.trim()) * weights[idx],
        0,
      );
      return (weightedAvg / weights.length).toString();
    default:
      return outputs.join("\n");
  }
};

// MOA Join Function with Iterations
const moaChainWithIterations = (
  promptFiles: string[],
  models: string[],
  iterations: number = 1,
  apiBase: string = OLLAMA_BASE_API1,
): string => {
  let output = promptFiles.map((file) => fs.readFileSync(file, "utf-8").trim()); // Read initial prompts

  for (let i = 0; i < iterations; i++) {
    console.log(`Iteration ${i + 1} started`);
    const outputs = [];
    for (let j = 0; j < models.length; j++) {
      const model = models[j];
      console.log(`Running model ${model}`);
      const prompt = output[j % output.length]; // Rotate through the prompt files
      const modelOutput = runModel(model, prompt, apiBase);
      outputs.push(modelOutput);
    }

    // Apply the MOA join mechanism
    output = [moaJoin(outputs, "concatenate")]; // Example: using concatenate join
    console.log(`Iteration ${i + 1} completed`);
  }

  return output[0]; // Final output after iterations
};

// CLI Command Input
const promptFiles = process.argv[2]?.split(",");
const models = process.argv[3]?.split(",");
const iterations = parseInt(process.argv[4] || "1", 10); // Default to 1 iteration if not specified

if (!promptFiles || !models) {
  console.error(
    "Usage: bun run moa_chain.ts <prompt_files> <models> <iterations>",
  );
  process.exit(1);
}

// Run the MOA Join Chain with Iterations
const finalOutput = moaChainWithIterations(promptFiles, models, iterations);

// Output the final result to a file
fs.writeFileSync("output/final_moa_output.txt", finalOutput);
console.log("Process completed successfully!");
