
'use client';
import React, { useState, useEffect } from 'react';
import {
  DesktopOutlined,
  FileOutlined,
  PieChartOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Layout, Menu, theme } from 'antd';
import { useRouter, usePathname } from 'next/navigation';

const { Header, Content, Footer, Sider } = Layout;

type MenuItem = Required<MenuProps>['items'][number];

function getItem(
  label: React.ReactNode,
  key: React.Key,
  icon?: React.ReactNode,
  children?: MenuItem[],
): MenuItem {
  return {
    key,
    icon,
    children,
    label,
  } as MenuItem;
}

const items: MenuItem[] = [
  getItem('数据看板', '/', <PieChartOutlined />),
  getItem('订单管理', '/orders', <DesktopOutlined />),
  getItem('数据报表', '/reports', <BarChartOutlined />),
];

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  const router = useRouter();
  const pathname = usePathname();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([pathname]);

  useEffect(() => {
    setSelectedKeys([pathname]);
  }, [pathname]);

  const onMenuClick: MenuProps['onClick'] = (e) => {
    router.push(e.key);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={(value) => setCollapsed(value)} theme="light">
        <div style={{ height: 32, margin: 16, background: 'rgba(0, 0, 0, 0.05)', borderRadius: 4 }} />
        <Menu 
          theme="light" 
          defaultSelectedKeys={['/']} 
          selectedKeys={selectedKeys}
          mode="inline" 
          items={items} 
          onClick={onMenuClick}
        />
      </Sider>
      <Layout>
        <Content style={{ margin: '0 16px' }}>
          {children}
        </Content>
        <Footer style={{ textAlign: 'center' }}>
          Zulin Dashboard ©{new Date().getFullYear()} Created by Zulin Tech
        </Footer>
      </Layout>
    </Layout>
  );
};

export default MainLayout;
