import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { OrderApiService } from '../../services/order-api.service';
import { OrderDetailResponse } from '../../models/order.models';
import { OrderQRDisplayComponent } from 'src/app/features/order-qr/order-qr-display/order-qr-display.component';

@Component({
  selector: 'order-detail',
  standalone: true,
  imports: [CommonModule, OrderQRDisplayComponent, RouterModule],
  templateUrl: './order-detail.component.html',
  styleUrl: './order-detail.component.css',
})
export class OrderDetailComponent implements OnInit, OnDestroy {
  order: OrderDetailResponse | null = null;
  isLoading: boolean = true; // Start as true, not false
  errorMessage: string = '';
  isProcessingTimeout: boolean = false;
  private destroy$ = new Subject<void>();
  private timeoutWindowTimerId: ReturnType<typeof setInterval> | null = null;
  private readonly userTimeoutWindowMinutes = 5;

  constructor(
    private orderApi: OrderApiService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    console.log('OrderDetailComponent initialized');
    console.log('Initial state - isLoading:', this.isLoading, 'order:', this.order);
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const orderId = +params['orderId'];
      console.log(' orderId from route:', orderId);
      if (orderId) {
        this.loadOrderDetail(orderId);
      } else {
        console.warn(' No orderId in route params');
        this.isLoading = false;
      }
    });
  }

  private loadOrderDetail(orderId: number): void {
    console.log('Loading order detail for orderId:', orderId);
    console.log('Before set - isLoading:', this.isLoading);
    this.isLoading = true;
    console.log('After set - isLoading:', this.isLoading);
    this.errorMessage = '';

    const subscription = this.orderApi
      .getOrderDetail(orderId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (order) => {
          console.log('NEXT CALLBACK FIRED ');
          console.log('Order detail loaded:', order);
          console.log('Setting order and isLoading = false');
          this.order = order;
          this.startTimeoutWindowTimer();
          this.isLoading = false;
          this.cdr.markForCheck();
          console.log('After update - isLoading:', this.isLoading, 'order:', this.order);
        },
        error: (error) => {
          console.error('ERROR CALLBACK FIRED');
          console.error('Error loading order detail:', error);
          this.errorMessage =
            error.error?.message || 'Failed to load order details. Please try again.';
          this.isLoading = false;
          this.cdr.markForCheck();
          console.error(' After update - isLoading:', this.isLoading, 'errorMessage:', this.errorMessage);
        },
      });
    console.log('Subscription created:', subscription);
  }

  onProcessTimeout(): void {
    if (!this.order || !this.canRequestTimeout()) {
      this.errorMessage = this.isTimeoutWindowExpired()
        ? 'Timeout can only be requested within 5 minutes of placing the order.'
        : '';
      return;
    }

    if (!confirm('Are you sure you want to request a timeout for this order?')) {
      return;
    }

    this.isProcessingTimeout = true;
    this.errorMessage = '';

    this.orderApi
      .processTimeout(this.order.orderId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (updatedOrder) => {
          this.order = updatedOrder;
          this.isProcessingTimeout = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          console.error('Error processing timeout:', error);
          this.errorMessage =
            error.error?.message || 'Failed to process timeout. Please try again.';
          this.isProcessingTimeout = false;
          this.cdr.markForCheck();
        },
      });
  }

  goBack(): void {
    this.router.navigate(['/orders']);
  }

  isOrderClosed(): boolean {
    if (!this.order) {
      return true;
    }

    const orderStatus = this.order.overallStatus?.toUpperCase();
    const paymentStatus = this.order.paymentStatus?.toUpperCase();

    return (
      orderStatus === 'CANCELLED' ||
      orderStatus === 'TIMEOUT' ||
      orderStatus === 'VENDOR_DECLINED' ||
      paymentStatus === 'REFUNDED'
    );
  }

  isPickupQrAvailable(): boolean {
    if (!this.order || this.isOrderClosed()) {
      return false;
    }

    const orderStatus = this.order.overallStatus?.toUpperCase();
    return orderStatus === 'VENDOR_ACCEPTED' || orderStatus === 'READY_FOR_PICKUP';
  }

  getPickupQrUnavailableMessage(): string {
    if (this.isOrderClosed()) {
      return 'Pickup QR is disabled because this order is cancelled or refunded.';
    }

    return 'Pickup QR will be available after the vendor accepts your order.';
  }

  getTimeoutButtonLabel(): string {
    if (this.isProcessingTimeout) {
      return 'Processing...';
    }

    if (this.isTimeoutWindowExpired() && !this.isOrderClosed()) {
      return 'Timeout Window Expired';
    }

    return this.isOrderClosed() ? 'Order Cancelled' : 'Request Timeout';
  }

  canRequestTimeout(): boolean {
    return !!this.order && !this.isOrderClosed() && !this.isTimeoutWindowExpired();
  }

  isTimeoutWindowExpired(): boolean {
    if (!this.order?.createdAt) {
      return true;
    }

    const deadline = this.getTimeoutDeadlineTime();
    return Number.isNaN(deadline) || Date.now() > deadline;
  }

  getTimeoutWindowMessage(): string {
    if (this.isOrderClosed()) {
      return 'This order is already closed.';
    }

    if (this.isTimeoutWindowExpired()) {
      return 'Timeout requests close 5 minutes after placing the order.';
    }

    return `Timeout available until ${new Date(this.getTimeoutDeadlineTime()).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  }

  getStatusColor(status: string): string {
    switch (status?.toUpperCase()) {
      case 'PENDING':
        return 'status-pending';
      case 'COMPLETED':
        return 'status-completed';
      case 'CANCELLED':
        return 'status-cancelled';
      default:
        return 'status-default';
    }
  }

  getVendorStatusColor(status: string): string {
    switch (status?.toUpperCase()) {
      case 'PREPARING':
        return 'vendor-preparing';
      case 'READY':
        return 'vendor-ready';
      case 'COMPLETED':
        return 'vendor-completed';
      case 'CANCELLED':
        return 'vendor-cancelled';
      default:
        return 'vendor-default';
    }
  }

  ngOnDestroy(): void {
    if (this.timeoutWindowTimerId) {
      clearInterval(this.timeoutWindowTimerId);
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  private startTimeoutWindowTimer(): void {
    if (this.timeoutWindowTimerId) {
      clearInterval(this.timeoutWindowTimerId);
    }

    this.timeoutWindowTimerId = setInterval(() => {
      this.cdr.markForCheck();
    }, 1000);
  }

  private getTimeoutDeadlineTime(): number {
    return new Date(this.order?.createdAt as string | Date).getTime() + this.userTimeoutWindowMinutes * 60 * 1000;
  }
}
