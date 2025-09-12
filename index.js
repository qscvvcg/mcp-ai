const express = require('express');
const cors = require('cors');
const tools = require('./mcp-tools');

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// MCP Server 元数据端点
app.get('/mcp/server', (req, res) => {
  res.json({
    version: '2024-08-01',
    capabilities: {
      tools: true
    }
  });
});

// 获取工具列表
app.get('/mcp/tools', (req, res) => {
  const toolList = tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
  res.json(toolList);
});

// 执行工具
app.post('/mcp/tools/:toolName/invoke', async (req, res) => {
  const { toolName } = req.params;
  const tool = tools.find(t => t.name === toolName);

  if (!tool) {
    return res.status(404).json({ error: 'Tool not found' });
  }

  try {
    const result = await tool.execute(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 根路径提示
app.get('/', (req, res) => {
  res.send(`
    <h1>MCP Server Running!</h1>
    <p>Available endpoints:</p>
    <ul>
      <li>GET /mcp/server</li>
      <li>GET /mcp/tools</li>
      <li>POST /mcp/tools/{toolName}/invoke</li>
    </ul>
  `);
});

const PORT =  3012;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ MCP Server is running on http://localhost:${PORT}`);
}).on('error', (err) => {
  console.error('❌ 启动失败:', err.message);
});