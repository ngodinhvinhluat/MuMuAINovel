import { Modal, Timeline, Tag, Empty, Spin, Button, Space, Typography, theme } from 'antd';
import {
  BellOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
  PushpinFilled,
  ReloadOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import type { Announcement, AnnouncementLevel } from '../types';
import MarkdownRenderer from './MarkdownRenderer';
import { t, getDateLocale } from '../i18n';

const { Paragraph, Text, Title } = Typography;

interface AnnouncementTimelineModalProps {
  visible: boolean;
  announcements: Announcement[];
  loading?: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onMarkAllRead: () => void;
}

const levelConfig: Record<AnnouncementLevel, { color: string; label: string; icon: React.ReactNode }> = {
  info: { color: 'blue', label: t('通知'), icon: <InfoCircleOutlined /> },
  success: { color: 'green', label: t('完成'), icon: <CheckCircleOutlined /> },
  warning: { color: 'orange', label: t('提醒'), icon: <WarningOutlined /> },
  error: { color: 'red', label: t('重要'), icon: <CloseCircleOutlined /> },
};

const formatDateTime = (value?: string | null) => {
  if (!value) return t('未设置时间');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('时间格式异常');
  return date.toLocaleString(getDateLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function AnnouncementTimelineModal({
  visible,
  announcements,
  loading = false,
  onClose,
  onRefresh,
  onMarkAllRead,
}: AnnouncementTimelineModalProps) {
  const { token } = theme.useToken();

  const handleClose = () => {
    onMarkAllRead();
    onClose();
  };

  return (
    <Modal
      title={
        <Space>
          <BellOutlined />
          <span>{t('系统公告')}</span>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            onClick={onRefresh}
            loading={loading}
            title={t('刷新公告')}
          />
        </Space>
      }
      open={visible}
      onCancel={handleClose}
      footer={[
        <Button key="close" type="primary" onClick={handleClose}>
          {t('关闭')}
        </Button>,
      ]}
      width={800}
      centered
      styles={{
        body: {
          maxHeight: '70vh',
          overflowY: 'auto',
          padding: '24px',
        },
      }}
    >
      <style>
        {`
          .announcement-timeline .ant-timeline-item-head-custom {
            background: transparent !important;
          }
        `}
      </style>
      {loading && announcements.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin size="large" tip={t('加载公告中...')} />
        </div>
      ) : announcements.length === 0 ? (
        <Empty description={t('暂无公告')} />
      ) : (
        <Timeline className="announcement-timeline">
          {announcements.map(item => {
            const config = levelConfig[item.level] || levelConfig.info;
            return (
              <Timeline.Item
                key={item.id}
                dot={
                  <div style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: 'transparent',
                    border: `2px solid ${token.colorPrimary}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: token.colorPrimary,
                  }}>
                    {item.pinned ? <PushpinFilled /> : <ExclamationCircleOutlined />}
                  </div>
                }
              >
                <div style={{ marginLeft: 10, paddingBottom: 18 }}>
                  <Space size="small" wrap style={{ marginBottom: 8 }}>
                    <Tag color={config.color} icon={config.icon}>{config.label}</Tag>
                    {item.pinned && <Tag color="gold" icon={<PushpinFilled />}>{t('置顶')}</Tag>}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <ClockCircleOutlined style={{ marginRight: 4 }} />
                      {formatDateTime(item.publish_at || item.created_at)}
                    </Text>
                  </Space>

                  <Title level={5} style={{ margin: '0 0 8px' }}>
                    {item.title}
                  </Title>

                  {item.summary && (
                    <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                      {item.summary}
                    </Paragraph>
                  )}

                  <MarkdownRenderer content={item.content} compact />

                  {item.author_name && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {t('发布者：{{author_name}}', { author_name: item.author_name })}
                    </Text>
                  )}
                </div>
              </Timeline.Item>
            );
          })}
        </Timeline>
      )}
    </Modal>
  );
}
