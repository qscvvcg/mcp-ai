const express = require('express');
const cors = require('cors');
const axios = require('axios');
const tools = require('./mcp-tools');

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 通义千问API配置
const QWEN_CONFIG = {
  apiKey: process.env.QWEN_API_KEY || "sk-cb5d9fe04d7b4adba5952fa2de765def",
  apiUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
  model: 'qwen-max'
};

// 工具描述生成（用于大模型决策）
function getToolsDescription() {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema.properties
  }));
}

// 智能工具调用决策函数
async function decideToolUsage(userMessage) {
  const toolsDescription = getToolsDescription();
  
  const decisionPrompt = `你是一个智能助手，需要根据用户问题决定是否调用工具。
  
可用工具列表：
${JSON.stringify(toolsDescription, null, 2)}

用户问题："${userMessage}"

请分析用户意图，严格按照以下JSON格式响应：
{
  "need_tool": true/false,
  "tool_name": "工具名称或null",
  "reason": "决策理由",
  "parameters": {"参数名": "参数值"} 或 {}
}

决策规则：
1. 如果用户询问天气相关，使用get_weather工具，参数city从问题中提取
2. 如果用户询问百科知识、搜索信息，使用search_wikipedia工具，参数query从问题中提取  
3. 如果用户需要数学计算，使用calculate_math工具，参数expression从问题中提取
4. 如果问题与以上工具无关，need_tool设为false

示例响应：
用户："北京天气怎么样？"
响应：{"need_tool": true, "tool_name": "get_weather", "reason": "用户询问天气信息", "parameters": {"city": "北京"}}

用户："你好，今天心情如何？"
响应：{"need_tool": false, "tool_name": null, "reason": "问题不需要工具调用", "parameters": {}}

请严格按照JSON格式响应，不要添加其他内容。`;

  try {
    const response = await callQwenAPI([
      {
        role: 'user',
        content: decisionPrompt
      }
    ]);

    // 解析大模型的工具调用决策
    const decision = JSON.parse(response.output.text);
    return decision;
  } catch (error) {
    console.error('工具决策解析失败:', error);
    // 决策失败时默认不使用工具
    return {
      need_tool: false,
      tool_name: null,
      reason: '决策解析失败，使用大模型直接回答',
      parameters: {}
    };
  }
}

// 调用通义千问API
async function callQwenAPI(messages, temperature = 0.7) {
  try {
    const requestData = {
      model: QWEN_CONFIG.model,
      input: {
        messages: messages
      },
      parameters: {
        temperature: temperature,
        top_p: 0.8,
        max_tokens: 2000
      }
    };

    const response = await axios.post(QWEN_CONFIG.apiUrl, requestData, {
      headers: {
        'Authorization': `Bearer ${QWEN_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    return response.data;
  } catch (error) {
    console.error('调用通义千问API失败:', error.response?.data || error.message);
    throw new Error(`API调用失败: ${error.message}`);
  }
}

// 智能工具调用主函数
async function smartToolCalling(userMessage) {
  try {
    console.log('收到用户消息:', userMessage);
    
    // 第一步：让大模型决定是否使用工具
    const decision = await decideToolUsage(userMessage);
    console.log('工具决策结果:', decision);

    if (decision.need_tool && decision.tool_name) {
      // 需要调用工具
      const toolName = decision.tool_name;
      const parameters = decision.parameters;
      
      // 检查工具是否存在
      const tool = tools.find(t => t.name === toolName);
      if (!tool) {
        throw new Error(`工具 ${toolName} 不存在`);
      }

      // 调用工具
      console.log(`调用工具: ${toolName}`, parameters);
      const toolResult = await tool.execute(parameters);
      console.log('工具执行结果:', toolResult);

      // 将工具结果发送给大模型生成最终回复
      const finalPrompt = `用户原始问题: "${userMessage}"
      
工具调用结果: ${JSON.stringify(toolResult, null, 2)}

请根据工具返回的数据，生成友好、自然的回答给用户。重点突出关键信息，保持回答简洁明了。`;

      const finalResponse = await callQwenAPI([
        {
          role: 'system',
          content: '你是一个有帮助的AI助手，能够根据工具返回的数据生成友好的回答。'
        },
        {
          role: 'user',
          content: finalPrompt
        }
      ]);

      return {
        type: 'tool_response',
        content: finalResponse.output.text,
        tool_used: {
          name: toolName,
          parameters: parameters,
          result: toolResult
        },
        decision_reason: decision.reason
      };
    } else {
      // 不需要调用工具，直接使用大模型回答
      console.log('直接使用大模型回答');
      const directResponse = await callQwenAPI([
        {
          role: 'system',
          content: '你是一个有帮助的AI助手，请直接回答用户的问题。'
        },
        {
          role: 'user',
          content: userMessage
        }
      ]);

      return {
        type: 'direct_response',
        content: directResponse.output.text,
        tool_used: null,
        decision_reason: decision.reason
      };
    }
  } catch (error) {
    console.error('智能工具调用出错:', error);
    // 出错时返回友好的错误信息
    return {
      type: 'error',
      content: `抱歉，处理您的请求时出现了问题：${error.message}`,
      tool_used: null,
      decision_reason: '处理过程中发生错误'
    };
  }
}

// MCP Server 元数据端点
app.get('/mcp/server', (req, res) => {
  res.json({
    version: '2024-08-01',
    capabilities: {
      tools: true,
      reasoning: true,
      smart_calling: true
    },
    vendor: {
      name: 'Smart MCP Server',
      version: '2.0.0'
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
  res.json({
    tools: toolList,
    count: tools.length
  });
});

// 执行工具（直接调用）
app.post('/mcp/tools/:toolName/invoke', async (req, res) => {
  const { toolName } = req.params;
  const tool = tools.find(t => t.name === toolName);

  if (!tool) {
    return res.status(404).json({ error: '工具不存在' });
  }

  try {
    console.log(`直接执行工具: ${toolName}`, req.body);
    const result = await tool.execute(req.body);
    res.json({
      success: true,
      tool: toolName,
      result: result,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ 
      success: false,
      error: err.message,
      tool: toolName
    });
  }
});

// 智能对话端点（主要接口）
app.post('/mcp/chat', async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: '消息内容不能为空' });
  }

  try {
    const result = await smartToolCalling(message);
    
    res.json({
      success: true,
      type: result.type,
      content: result.content,
      tool_used: result.tool_used,
      decision_reason: result.decision_reason,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: '处理请求时发生错误',
      details: error.message
    });
  }
});

// 批量工具调用端点
app.post('/mcp/tools/batch', async (req, res) => {
  const { operations } = req.body;

  if (!Array.isArray(operations)) {
    return res.status(400).json({ error: 'operations 必须为数组' });
  }

  const results = [];
  for (const op of operations) {
    const { toolName, parameters } = op;
    const tool = tools.find(t => t.name === toolName);
    
    if (!tool) {
      results.push({ toolName, success: false, error: '工具不存在' });
      continue;
    }

    try {
      const result = await tool.execute(parameters);
      results.push({ toolName, success: true, result });
    } catch (error) {
      results.push({ toolName, success: false, error: error.message });
    }
  }

  res.json({ results });
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    tools_available: tools.length,
    model: QWEN_CONFIG.model,
    features: ['smart_tool_calling', 'direct_tool_invoke', 'batch_operations']
  });
});

// 测试界面
app.get('/test', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
      <title>MCP 智能工具调用测试</title>
      <style>
          body { font-family: Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; }
          .container { display: flex; gap: 20px; }
          .panel { flex: 1; border: 1px solid #ddd; padding: 20px; border-radius: 10px; }
          .test-case { background: #f5f5f5; padding: 10px; margin: 10px 0; cursor: pointer; }
          .result { background: #f0f8ff; padding: 15px; margin: 10px 0; border-radius: 5px; }
      </style>
  </head>
  <body>
      <h1>🔧 MCP 智能工具调用测试</h1>
      
      <div class="container">
          <div class="panel">
              <h3>测试用例</h3>
              <div class="test-case" onclick="testCase('北京天气怎么样？')">🌤️ 测试天气查询</div>
              <div class="test-case" onclick="testCase('搜索人工智能的发展历史')">📚 测试百科搜索</div>
              <div class="test-case" onclick="testCase('计算一下 (25 + 38) * 3 的结果')">🧮 测试数学计算</div>
              <div class="test-case" onclick="testCase('你好，请介绍一下自己')">💬 测试直接对话</div>
              
              <h3>自定义测试</h3>
              <input type="text" id="customInput" placeholder="输入测试问题..." style="width: 100%; padding: 10px; margin: 10px 0;">
              <button onclick="runCustomTest()" style="width: 100%; padding: 10px;">运行测试</button>
          </div>
          
          <div class="panel">
              <h3>测试结果</h3>
              <div id="testResults">
                  测试结果将显示在这里...
              </div>
          </div>
      </div>

      <script>
          async function testCase(message) {
              document.getElementById('customInput').value = message;
              await runCustomTest();
          }
          
          async function runCustomTest() {
              const message = document.getElementById('customInput').value;
              if (!message) return;
              
              const resultsDiv = document.getElementById('testResults');
              resultsDiv.innerHTML = '测试中...';
              
              try {
                  const response = await fetch('/mcp/chat', {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ message })
                  });
                  
                  const data = await response.json();
                  
                  let resultHTML = \`
                      <div class="result">
                          
                          <strong>AI回复:</strong> \${data.content}<br>
                  \`;
                  
                 
                  
                  resultHTML += '</div>';
                  resultsDiv.innerHTML = resultHTML;
                  
              } catch (error) {
                  resultsDiv.innerHTML = \`错误: \${error.message}\`;
              }
          }
          
          // 页面加载时自动测试
          window.onload = () => testCase('北京天气怎么样？');
      </script>
  </body>
  </html>
  `;
  res.send(html);
});

// 根路径
app.get('/', (req, res) => {
  res.redirect('/test');
});

const PORT = process.env.PORT || 8084;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ MCP Server 运行在 http://localhost:${PORT}`);
  console.log(`🤖 集成通义千问模型: ${QWEN_CONFIG.model}`);
  console.log(`🛠️ 可用工具数量: ${tools.length}`);
  console.log(`🌐 测试界面: http://localhost:${PORT}/test`);
  console.log(`💡 智能工具调用功能已启用`);
}).on('error', (err) => {
  console.error('❌ 启动失败:', err.message);
});
