#!/usr/bin/env python3
import json, time, sys, urllib.request

SESSION_ID = f"test-session-{int(time.time())}"

def make_request(method, params, req_id):
    data = json.dumps({'jsonrpc': '2.0', 'id': req_id, 'method': method, 'params': params}).encode()
    req = urllib.request.Request('http://localhost:3006/mcp', data=data, headers={
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': SESSION_ID,
    }, method='POST')
    resp = urllib.request.urlopen(req).read().decode()
    lines = [l[6:] for l in resp.split('\n') if l.startswith('data: ')]
    return json.loads(lines[0]) if lines else None

try:
    print("🔍 Testing MCP Server\n")
    print("📤 Initialize...")
    make_request('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1.0'}}, 1)
    print("✅ OK\n")
    
    print("📤 List tools...")
    data = make_request('tools/list', {}, 2)
    if data and 'result' in data:
        tools = data['result']['tools']
        print(f"\n📋 {len(tools)} tools available:\n")
        for i, t in enumerate(tools, 1):
            print(f"{i}. {t['name']}")
            print(f"   {t['description']}\n")
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
