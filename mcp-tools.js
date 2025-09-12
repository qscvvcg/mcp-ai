// mcp-tools.js

const axios = require('axios');

/**
 * 工具1: 获取天气
 */
const getWeatherTool = {
  name: 'get_weather',
  description: '获取指定城市的当前天气信息（温度、湿度、描述）',
  inputSchema: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称，例如 Beijing, Shanghai'
      }
    },
    required: ['city']
  },
  execute: async (input) => {
    try {
      // 使用免费天气 API（无需 key）
      const res = await axios.get('https://wttr.in/' + input.city + '?format=j1');
      const data = res.data;
      return {
        location: input.city,
        temperature: data.current_condition[0].temp_C + '°C',
        feelslike: data.current_condition[0].FeelsLikeC + '°C',
        humidity: data.current_condition[0].humidity + '%',
        weather_desc: data.current_condition[0].weatherDesc[0].value,
        visibility: data.current_condition[0].visibility + ' km'
      };
    } catch (err) {
      return { error: '无法获取天气数据，请检查城市名称是否正确。' };
    }
  }
};

/**
 * 工具2: 搜索 Wikipedia 摘要
 */
const searchWikipediaTool = {
  name: 'search_wikipedia',
  description: '搜索维基百科上某个主题的简要介绍',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '要搜索的主题，例如 Albert Einstein, Python programming'
      }
    },
    required: ['query']
  },
  execute: async (input) => {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(input.query)}`;
      const res = await axios.get(url);
      const data = res.data;
      return {
        title: data.title,
        extract: data.extract,
        url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${input.query}`
      };
    } catch (err) {
      return { error: '未找到相关词条，请尝试更准确的关键词。' };
    }
  }
};

/**
 * 工具3: 数学计算
 */
const calculateMathTool = {
  name: 'calculate_math',
  description: '计算数学表达式，支持 + - * / ^ 和括号',
  inputSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式，例如 (5 + 3) * 2 或 sqrt(16)'
      }
    },
    required: ['expression']
  },
  execute: async (input) => {
    try {
      // 使用 mathjs 简单计算（先安装：npm install mathjs）
      const math = require('mathjs');
      const result = math.evaluate(input.expression);
      return {
        expression: input.expression,
        result: result.toString()
      };
    } catch (err) {
      return { error: '数学表达式无效，请检查语法。' };
    }
  }
};

module.exports = [
  getWeatherTool,
  searchWikipediaTool,
  calculateMathTool
];