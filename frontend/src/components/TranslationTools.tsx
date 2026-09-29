import { useState } from 'react';
import { Button, Popconfirm, Space, Switch, Typography, message } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import {
  clearMissingTranslations,
  getLanguage,
  getMissingTranslations,
  getShowOriginal,
  setShowOriginal,
  t,
} from '../i18n';

const { Text } = Typography;

/**
 * Công cụ lớp nghĩa: bật/tắt tooltip giá trị gốc và xuất các chuỗi chưa dịch đã gặp khi dùng app.
 * Chỉ hiện khi giao diện không phải tiếng Trung.
 */
export default function TranslationTools() {
  const [showOriginal, setShowOriginalState] = useState(getShowOriginal());
  const [, forceUpdate] = useState(0);

  if (getLanguage() === 'zh') return null;

  const missing = getMissingTranslations();
  const total = missing.translation.length + missing.values.length;

  const handleToggle = (checked: boolean) => {
    setShowOriginal(checked);
    setShowOriginalState(checked);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(missing, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mumu-missing-translations.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleClear = () => {
    clearMissingTranslations();
    forceUpdate((n) => n + 1);
    message.success(t('已清空'));
  };

  return (
    <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 12 }}>
      <Space size={8} wrap>
        <Switch size="small" checked={showOriginal} onChange={handleToggle} />
        <Text>{t('鼠标悬停时显示中文原文')}</Text>
      </Space>
      <Space size={8} wrap>
        <Button size="small" icon={<DownloadOutlined />} disabled={!total} onClick={handleExport}>
          {t('导出未翻译文本 ({{count}})', { count: total })}
        </Button>
        <Popconfirm title={t('确定清空未翻译文本记录？')} onConfirm={handleClear} disabled={!total}>
          <Button size="small" disabled={!total}>
            {t('清空记录')}
          </Button>
        </Popconfirm>
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {t('使用过程中遇到的未翻译文本会被记录。导出后运行 node scripts/i18n-translate.mjs --from 文件路径 即可自动翻译。')}
      </Text>
    </Space>
  );
}
