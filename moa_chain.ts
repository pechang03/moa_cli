import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
import { $ } from "bun";
import { DOMParser } from '@xmldom/xmldom';

dotenv.config();

// Type definitions for MOA architecture
interface OllamaInstance {
    uri: string; 
    name?: string;
    priority?: number;
}

interface Agent {
    name: string;
    model: string;  // Full model identifier (e.g. "ollama:llama2" or "gpt-4")
    temperature?: number;
    promptTemplate: string;  // Required for all agents
    systemPrompt?: string;
}

interface AgentConfig extends Agent {
    instanceUri?: string;  // Override default URI for specific agent
}

interface Layer {
    name: string;
    agents: Agent[];
    aggregationStrategy: AggregationStrategy;
}

interface ModelResponse {
    content: string;
    metadata?: Record<string, any>;
    error?: string;
}

interface QueryContext {
    originalQuery: string;
    timestamp: string;
    currentIteration: number;
}

interface AggregationStrategy {
    method: "voting" | "synthesis" | "concatenate" | "weighted";
    promptTemplate?: string;
    weights?: number[];
}

interface MOAConfig {
    layers: Layer[];
    maxIterations: number;
    stopCriteria?: (responses: ModelResponse[]) => boolean;
}

// Environment configurations
const OUTPUT_DIR = process.env.OUTPUT_DIR || "output";
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || "ollama:tinyllama:1.1b-chat-v1-q5_K_M";
const SYNTHESIS_MODEL = process.env.SYNTHESIS_MODEL || "ollama:qwen2.5-coder:7b-instruct-fp16";
const MAX_INSTANCES = parseInt(process.env.MAX_INSTANCES || '2');

// Load Ollama instances from environment
const ollamaInstances: OllamaInstance[] = Object.entries(process.env)
    .filter(([key]) => key.startsWith('OLLAMA_API_URL_'))
    .map(([key, value]) => ({
        uri: value!,
        name: key.replace('OLLAMA_API_URL_', ''),
        priority: parseInt(process.env[`OLLAMA_PRIORITY_${key.replace('OLLAMA_API_URL_', '')}`] || '1')
    }))
    .slice(0, MAX_INSTANCES);

// Round-robin instance selection
let currentInstanceIndex = 0;
function getNextInstance(): OllamaInstance {
    if (ollamaInstances.length === 0) {
        return { uri: 'http://localhost:11434' };
    }
    const instance = ollamaInstances[currentInstanceIndex];
    currentInstanceIndex = (currentInstanceIndex + 1) % ollamaInstances.length;
    return instance;
}

// Helper function to get unique Ollama models from config
function getUniqueModels(config: MOAConfig): string[] {
    const models = new Set<string>();
    config.layers.forEach(layer => {
        layer.agents.forEach(agent => {
            if (agent.model.startsWith('ollama:')) {
                models.add(agent.model.replace('ollama:', ''));
            }
        });
    });
    // Add synthesis model if it's an Ollama model
    if (SYNTHESIS_MODEL.startsWith('ollama:')) {
        models.add(SYNTHESIS_MODEL.replace('ollama:', ''));
    }
    return Array.from(models);
}

// Function to preload models and keep them in memory
async function preloadModels(models: string[]): Promise<void> {
    console.log('[DEBUG] Preloading models:', models);
    const instance = getNextInstance();
    
    for (const model of models) {
        try {
            // Use curl to preload with keep_alive set to -1
            await $`curl -s ${instance.uri}/api/generate -d '{"model": "${model}", "keep_alive": -1, "prompt": ""}'`;
            console.log(`[DEBUG] Preloaded model: ${model}`);
        } catch (error) {
            console.error(`[ERROR] Failed to preload model ${model}:`, error);
            throw error;
        }
    }
}

// XML prompt parsing utility
async function readXMLPrompt(promptFile: string): Promise<{ systemPrompt?: string, template: string }> {
    // Validate file path
    const resolvedPath = path.resolve(promptFile);
    if (!resolvedPath.includes(process.cwd())) {
        throw new Error('File path must be within current working directory');
    }

    // Check if file exists
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Prompt file not found: ${promptFile}`);
    }

    // Check file size (limit to 1MB)
    const stats = fs.statSync(resolvedPath);
    const MAX_FILE_SIZE = 1024 * 1024; // 1MB
    if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`Prompt file too large: ${stats.size} bytes (max ${MAX_FILE_SIZE} bytes)`);
    }

    try {
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/xml');
        
        // Validate XML structure
        if (!doc.getElementsByTagName('prompt')[0]) {
            throw new Error('Invalid XML: missing root <prompt> element');
        }
        
        const systemElement = doc.getElementsByTagName('system')[0];
        const templateElement = doc.getElementsByTagName('template')[0];
        
        if (!templateElement) {
            throw new Error('Invalid XML: missing <template> element');
        }
        
        return {
            systemPrompt: systemElement?.textContent?.trim(),
            template: templateElement?.textContent?.trim() || ''
        };
    } catch (error) {
        console.error(`[ERROR] Failed to read/parse XML prompt file: ${promptFile}`, error);
        throw error;
    }
}

// Default aggregation prompt template from the paper
const DEFAULT_AGGREGATION_TEMPLATE = `
You are tasked with synthesizing multiple responses to create a comprehensive and accurate final answer.

Previous responses:
{{responses}}

Please analyze these responses and:
1. Identify common themes and key points
2. Note any contradictions or inconsistencies
3. Synthesize a final response that:
- Incorporates the best elements from each response
- Resolves any contradictions
- Provides a coherent and complete answer

Final synthesized response:`;
// Function to call a model
async function runModel(agent: AgentConfig, prompt: string): Promise<ModelResponse> {
    console.log(`\n[DEBUG] Running model ${agent.model}`);
    console.log(`[DEBUG] Prompt: ${prompt}`);

    try {
        let output: string;
        const instanceUri = agent.instanceUri || getNextInstance().uri;

        if (agent.model.startsWith("ollama:")) {
            const modelName = agent.model.replace('ollama:', '');
            const result = await $`OLLAMA_HOST=${instanceUri} ollama run ${modelName} "${prompt}"`;
            output = result.stdout.toString();
        } else if (agent.model.startsWith("llm:")) {
            const modelName = agent.model.replace('llm:', '');
            const result = await $`llm -m ${modelName} "${prompt}"`;
            output = result.stdout.toString();
        } else {
            throw new Error(`Unsupported model prefix in: ${agent.model}`);
        }
        
        if (!output || output.trim().length === 0) {
            throw new Error("Model returned empty response");
        }
        
        return { content: output.trim() };
    } catch (error) {
        console.error(`[ERROR] Model execution failed:`, error);
        throw new Error(`Error running model ${agent.model}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function processLayer(
    layer: Layer,
    input: string,
    previousResponses: ModelResponse[] = [],
    queryContext?: QueryContext
): Promise<ModelResponse[]> {
    console.log(`[DEBUG] Processing layer ${layer.name} across ${ollamaInstances.length || 1} instances`);

    const agentPromises = layer.agents.map(async (agent, index) => {
        // Assign different instances to agents round-robin style
        const instance = getNextInstance();
        console.log(`[DEBUG] Assigning agent ${agent.name} to instance ${instance.uri}`);
    // Read XML prompt if promptTemplate is a file path
    let promptContent = agent.promptTemplate;
    let systemPrompt = agent.systemPrompt;
    
    if (agent.promptTemplate.endsWith('.xml')) {
        const xmlPrompt = await readXMLPrompt(agent.promptTemplate);
        promptContent = xmlPrompt.template;
        systemPrompt = xmlPrompt.systemPrompt || systemPrompt;
    }

    const contextualPrompt = promptContent
        .replace("{input}", input)
        .replace("{previous_responses}", previousResponses.map(r => r.content).join("\n"));
    
    return runModel({ ...agent, promptTemplate: contextualPrompt, systemPrompt }, contextualPrompt);
});

return Promise.all(agentPromises);
}

async function aggregateResponses(
responses: ModelResponse[],
strategy: AggregationStrategy
): Promise<ModelResponse> {
if (responses.length === 0) {
    return { content: "", error: "No responses to aggregate" };
}

// Handle XML template if specified
if (strategy.promptTemplate?.endsWith('.xml')) {
    const xmlPrompt = await readXMLPrompt(strategy.promptTemplate);
    strategy.promptTemplate = xmlPrompt.template;
}

switch (strategy.method) {
    case "synthesis": {
    // Use a model to synthesize responses using the aggregation template
    const synthesisAgent: Agent = {
        name: "synthesizer",
        model: SYNTHESIS_MODEL,
        promptTemplate: strategy.promptTemplate || DEFAULT_AGGREGATION_TEMPLATE
    };

    const synthesisPrompt = synthesisAgent.promptTemplate.replace(
        "{responses}",
        responses.map((r, i) => `Response ${i + 1}:\n${r.content}`).join("\n\n")
    );

    return runModel(synthesisAgent, synthesisPrompt);
    }
    
    case "weighted": {
    const weights = strategy.weights || responses.map(() => 1 / responses.length);
    const weightedContent = responses
        .map((r, i) => r.content.trim())
        .reduce((acc, content, i) => acc + content * weights[i], "");
    return { content: weightedContent };
    }

    case "voting":
    // Implement voting logic if needed
    return { content: responses[0].content }; // Placeholder

    case "concatenate":
    default:
    return {
        content: responses.map(r => r.content.trim()).join("\n\n")
    };
}
}

async function runMOAChain(
config: MOAConfig,
initialInput: string
): Promise<ModelResponse> {
let currentInput = initialInput;
let allResponses: ModelResponse[] = [];

// Create query context with XML structure
const queryContext: QueryContext = {
    originalQuery: initialInput,
    timestamp: new Date().toISOString(),
    currentIteration: 0
};

try {
    // Ensure maxIterations has a valid value
    const maxIterations = config.maxIterations || 1;
    console.log(`[DEBUG] Starting MOA chain with ${maxIterations} max iterations`);
    
    for (let iteration = 0; iteration < maxIterations; iteration++) {
        console.log(`\n[DEBUG] Iteration ${iteration + 1} started`);
    
    for (const layer of config.layers) {
        console.log(`Processing layer: ${layer.name}`);
        
        // Process all agents in the current layer
        console.log(`[DEBUG] Current input for layer: ${currentInput.substring(0, 100)}...`);
        // Update iteration count in queryContext
        queryContext.currentIteration = iteration;
        const layerResponses = await processLayer(layer, currentInput, allResponses, queryContext);

        console.log(`[DEBUG] Layer ${layer.name} responses:`, 
            layerResponses.map(r => ({
                content: r.content.substring(0, 100) + "...",
                error: r.error
            }))
        );

        // Check for errors in layer responses
        const errors = layerResponses.filter(r => r.error);
        if (errors.length > 0) {
            console.error(`[ERROR] Errors in layer ${layer.name}:`, errors);
            throw new Error(`Layer ${layer.name} execution failed: ${errors[0].error}`);
        }
        
        // Aggregate responses from the current layer
        const aggregated = await aggregateResponses(layerResponses, layer.aggregationStrategy);
        allResponses = [...allResponses, aggregated];
        currentInput = aggregated.content;
        
        // Check if we should stop based on custom criteria
        if (config.stopCriteria && config.stopCriteria(allResponses)) {
        console.log("Stop criteria met, ending iterations");
        return aggregated;
        }
    }
    
    console.log(`Iteration ${iteration + 1} completed`);
    }
    
    console.log(`[DEBUG] MOA chain completed. Total responses: ${allResponses.length}`);
    return {
        content: currentInput,
        metadata: { 
            iterations: config.maxIterations, 
            totalResponses: allResponses.length,
            finalResponseLength: currentInput.length
        }
    };
} catch (error) {
    return {
    content: "",
    error: `Error in MOA chain: ${error instanceof Error ? error.message : String(error)}`
    };
}
}

// Example usage and CLI handling
async function main() {
const promptFile = process.argv[2];
const configFile = process.argv[3];

if (!promptFile || !configFile) {
    console.error("Usage: bun run moa_chain.ts <prompt_file> <config_file>");
    process.exit(1);
}

try {
    const initialPrompt = fs.readFileSync(promptFile, "utf-8").trim();
    const config: MOAConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));

    // Preload models before starting the chain
    const uniqueModels = getUniqueModels(config);
    await preloadModels(uniqueModels);

    const result = await runMOAChain(config, initialPrompt);
    
    if (result.error) {
    console.error("Error in MOA chain:", result.error);
    process.exit(1);
    }

    // Output the final result to a file
    fs.writeFileSync(`${OUTPUT_DIR}/final_moa_output.txt`, result.content);
    console.log("Process completed successfully!");
    
    if (result.metadata) {
    console.log("Metadata:", result.metadata);
    }
} catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
}
}

main().catch(console.error);
