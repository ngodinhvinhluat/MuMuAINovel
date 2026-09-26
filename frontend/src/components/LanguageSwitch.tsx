import { Segmented, Select } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { getLanguage, setLanguage, SUPPORTED_LANGUAGES, t, type AppLanguage } from '../i18n';

interface LanguageSwitchProps {
  size?: 'small' | 'middle' | 'large';
  /** block: 分段控件铺满宽度（侧边栏使用）；否则显示为下拉框 */
  block?: boolean;
}

/**
 * 界面语言切换（中文 / Tiếng Việt）。切换后会刷新页面。
 */
export default function LanguageSwitch({ size = 'middle', block = false }: LanguageSwitchProps) {
  const current = getLanguage();
  const handleChange = (value: AppLanguage) => setLanguage(value);

  if (block) {
    return (
      <Segmented
        size={size}
        block
        value={current}
        onChange={(value) => handleChange(value as AppLanguage)}
        options={SUPPORTED_LANGUAGES.map((lang) => ({ value: lang.value, label: lang.label }))}
        title={t('界面语言')}
      />
    );
  }

  return (
    <Select
      size={size}
      value={current}
      onChange={handleChange}
      options={SUPPORTED_LANGUAGES.map((lang) => ({ value: lang.value, label: lang.label }))}
      suffixIcon={<GlobalOutlined />}
      popupMatchSelectWidth={false}
      style={{ minWidth: 118 }}
      aria-label={t('界面语言')}
    />
  );
}
