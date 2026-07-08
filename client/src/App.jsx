import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import RequireAdmin from './components/RequireAdmin.jsx';
import Home from './pages/Home.jsx';
import Product from './pages/Product.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import MyPage from './pages/MyPage.jsx';
import Welcome from './pages/Welcome.jsx';
import AdminLayout from './components/admin/AdminLayout.jsx';
import Dashboard from './pages/admin/Dashboard.jsx';
import OrdersAdmin from './pages/admin/OrdersAdmin.jsx';
import OrderDetail from './pages/admin/OrderDetail.jsx';
import ProductsAdmin from './pages/admin/ProductsAdmin.jsx';
import MembersAdmin from './pages/admin/MembersAdmin.jsx';
import MemberDetail from './pages/admin/MemberDetail.jsx';
import ReviewsAdmin from './pages/admin/ReviewsAdmin.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import CategoryList from './pages/CategoryList.jsx';
import Search from './pages/Search.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/objects/:id" element={<Product />} />
        <Route path="/category/:type" element={<CategoryList />} />
        <Route path="/search" element={<Search />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/cart" element={<Cart />} />
        <Route
          path="/checkout"
          element={
            <RequireAuth>
              <Checkout />
            </RequireAuth>
          }
        />
        <Route
          path="/mypage"
          element={
            <RequireAuth>
              <MyPage />
            </RequireAuth>
          }
        />
      </Route>

      {/* 어드민 — 스토어 Layout(헤더) 밖, 전용 셸 */}
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AdminLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="orders" element={<OrdersAdmin />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="products" element={<ProductsAdmin />} />
        <Route path="members" element={<MembersAdmin />} />
        <Route path="members/:id" element={<MemberDetail />} />
        <Route path="reviews" element={<ReviewsAdmin />} />
      </Route>
    </Routes>
  );
}
