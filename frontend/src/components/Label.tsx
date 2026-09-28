import { Tooltip } from 'antd';
import { getLanguage, getShowOriginal, label } from '../i18n';

interface LabelProps {
  /** Giá trị gốc (tiếng Trung) lấy từ dữ liệu */
  value?: string | null;
}

/**
 * Hiển thị giá trị dữ liệu bằng ngôn ngữ giao diện; rê chuột để xem giá trị gốc.
 */
export default function Label({ value }: LabelProps) {
  if (value == null || value === '') return null;
  const text = label(value);
  if (text === value || getLanguage() === 'zh' || !getShowOriginal()) return <>{text}</>;
  return (
    <Tooltip title={value} mouseEnterDelay={0.4}>
      <span>{text}</span>
    </Tooltip>
  );
}
