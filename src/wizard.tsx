#!/usr/bin/env node
import React, { useState, useEffect } from "react";
import { render, Text, Box } from "ink";
import SelectInput from "ink-select-input";
import chalk from "chalk";
import { PRESETS } from "./presets.js";
import { loadConfig, loadEnv, setEnvVar, writeExample, writeTypes, scanForEnvKeys } from "./index.js";

const Neon = ({children}:{children:any}) => <Text>{chalk.hex("#00E5FF").bold(children)}</Text>;
const Muted = ({children}:{children:any}) => <Text>{chalk.hex("#9AA0A6")(children)}</Text>;

function App() {
  const [screen, setScreen] = useState<"home"|"presets"|"set"|"generate"|"done">("home");
  const [log, setLog] = useState<string[]>([]);

  const items = [
    { label: "Apply Preset Keys", value: "presets" },
    { label: "Set/Update a Variable", value: "set" },
    { label: "Generate Types & Example", value: "generate" },
    { label: "Exit", value: "done" },
  ];

  const onSelect = (item: any) => {
    if (item.value === "exit") process.exit(0);
    setScreen(item.value);
  };

  if (screen==="home") {
    return (
      <Box flexDirection="column">
        <Text>
          {chalk.bgHex("#5A00A0").hex("#00FFD1").bold("  ENVRANGER WIZARD  ")} <Muted>neon mode</Muted>
        </Text>
        <Box marginTop={1} flexDirection="column">
          <SelectInput items={items} onSelect={onSelect} />
        </Box>
        <Box flexDirection="column" marginTop={1}>
          {log.map((l, i)=>(<Text key={i}>{l}</Text>))}
        </Box>
      </Box>
    );
  }

  if (screen === "presets") {
    const options = PRESETS.map(p=>({ label: `${p.name} — ${p.description}`, value: p.name }));
    return (
      <Box flexDirection="column">
        <Neon>Choose a preset to append keys into your .env and .env.example</Neon>
        <SelectInput items={[...options, {label:"Back", value:"back"}]} onSelect={(item:any)=>{
          if (item.value==="back") return setScreen("home");
          const preset = PRESETS.find(p=>p.name===item.value)!;
          for (const k of preset.keys) {
            setEnvVar(".env", k, "");
          }
          writeExample(loadEnv(), ".env.example");
          setLog(l=>[...l, chalk.green(`Preset '${preset.name}' applied (${preset.keys.length} keys).`)]);
          setScreen("home");
        }} />
      </Box>
    );
  }

  if (screen === "set") {
    // Minimalistic: set KEY=VALUE via environment variable ENVRANGER_PAIR (simple for TUI demo)
    return (
      <Box flexDirection="column">
        <Neon>Set/Update a variable</Neon>
        <Text>Run: {chalk.cyan("ENVRANGER_PAIR=KEY=VALUE envranger wizard")}</Text>
        <Text><Muted>For now, wizard reads one pair from ENVRANGER_PAIR to stay keyboard-first.</Muted></Text>
        {process.env.ENVRANGER_PAIR ? (
          (()=>{
            const [k, ...rest] = String(process.env.ENVRANGER_PAIR).split("=");
            const v = rest.join("=");
            if (k && v !== undefined) {
              setEnvVar(".env", k, v);
              return <Text>{chalk.green(`Set ${k}`)}</Text>;
            }
            return <Text>{chalk.red("Invalid ENVRANGER_PAIR format.")}</Text>;
          })()
        ) : <Text><Muted>No ENVRANGER_PAIR provided.</Muted></Text>}
        <Text>Press any key to go back.</Text>
      </Box>
    );
  }

  if (screen === "generate") {
    useEffect(() => {
      (async () => {
        const cfg = await loadConfig();
        const res = await scanForEnvKeys(cfg);
        writeTypes(res.keys);
        writeExample(loadEnv(), ".env.example");
        setLog(l => [...l, chalk.green(`Generated types and example file.`)]);
        setScreen("home");
      })();
    }, []);
    return <Text>Generating...</Text>;
  }

  if (screen==="done") {
    return <Text>Bye!</Text>;
  }

  return null;
}

render(<App />);
