const fs = require('fs');

// Read the file
const data = JSON.parse(fs.readFileSync('test-data/results/framework-comparison-2026-01-04T03-32-40-139Z.json', 'utf-8'));

// Fix the baseline flows
if (data[0].conditionA_Baseline.flows) {
  data[0].conditionA_Baseline.flows = data[0].conditionA_Baseline.flows.map(flow => {
    // Fix the extremely long parentFlow
    if (flow.parentFlow && flow.parentFlow.startsWith('MAIN_FLOW_ID_HERE')) {
      flow.parentFlow = 'MAIN';
    }
    return flow;
  });
  
  // Remove duplicate flows (keep only the last one for each ID)
  const flowMap = new Map();
  data[0].conditionA_Baseline.flows.forEach(flow => {
    flowMap.set(flow.id, flow);
  });
  data[0].conditionA_Baseline.flows = Array.from(flowMap.values());
}

// Fix the framework flows
if (data[0].conditionB_Framework.flows) {
  // Remove duplicate flows
  const flowMap = new Map();
  data[0].conditionB_Framework.flows.forEach(flow => {
    flowMap.set(flow.id, flow);
  });
  data[0].conditionB_Framework.flows = Array.from(flowMap.values());
}

// Write back
fs.writeFileSync('test-data/results/framework-comparison-2026-01-04T03-32-40-139Z.json', JSON.stringify(data, null, 2));
console.log('Fixed JSON file successfully');
