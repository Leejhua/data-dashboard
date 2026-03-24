
'use client';
import React, { useEffect, useState } from 'react';
import {
  DesktopOutlined,
  PieChartOutlined,
  BarChartOutlined,
  ApartmentOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Layout, Menu } from 'antd';
import { useRouter, usePathname } from 'next/navigation';

const { Content, Footer, Sider } = Layout;

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
  getItem('数据看板', '/dashboard', <PieChartOutlined />, [
    getItem('平台总览', '/dashboard/overview'),
    getItem('芝麻租赁', '/dashboard/zulin'),
  ]),
  getItem('订单管理', '/orders', <DesktopOutlined />),
  getItem('映射管理', '/product-mappings', <ApartmentOutlined />),
  getItem('数据报表', '/reports', <BarChartOutlined />),
];

interface MainLayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSE_STORAGE_KEY = 'dashboard_sidebar_collapsed';

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === '1';
  });
  const router = useRouter();
  const pathname = usePathname();
  const selectedKeys = pathname ? [pathname === '/' ? '/dashboard/overview' : pathname] : [];
  const openKeys = pathname?.startsWith('/dashboard') ? ['/dashboard'] : [];

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  const onMenuClick: MenuProps['onClick'] = (e) => {
    router.push(e.key);
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={(value) => setCollapsed(value)} theme="light">
        <div style={{ height: 32, margin: 16, background: 'rgba(0, 0, 0, 0.05)', borderRadius: 4 }} />
        <Menu 
          theme="light" 
          selectedKeys={selectedKeys}
          defaultOpenKeys={openKeys}
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
