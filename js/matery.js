$(function () {
    /**
     * 添加文章卡片hover效果.
     */
    let articleCardHover = function () {
        let animateClass = 'animated pulse';
        $('article .article').hover(function () {
            $(this).addClass(animateClass);
        }, function () {
            $(this).removeClass(animateClass);
        });
    };
    articleCardHover();

    /*菜单切换*/
    let hasOpenSidenav = function () {
        return $('.sidenav').filter(function () {
            let instance = M.Sidenav.getInstance(this);
            return instance && instance.isOpen;
        }).length > 0;
    };
    let hasOpenModal = function () {
        return $('.modal').filter(function () {
            let instance = M.Modal.getInstance(this);
            return (instance && instance.isOpen) || $(this).hasClass('open');
        }).length > 0;
    };
    let reconcilePageScroll = function () {
        let sidenavOpen = hasOpenSidenav();
        let modalOpen = hasOpenModal();
        $('body').toggleClass('mobile-sidenav-open', sidenavOpen);
        $('body').toggleClass('mobile-modal-open', modalOpen);

        // LightGallery is locked by body.lg-on in CSS, so it cannot leave an
        // inline overflow value behind when its own close lifecycle finishes.
        if (sidenavOpen || modalOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.removeProperty('overflow');
            document.documentElement.style.removeProperty('overflow');
        }
    };
    let closeOpenComponents = function () {
        $('.sidenav').each(function () {
            let instance = M.Sidenav.getInstance(this);
            if (instance && instance.isOpen) {
                instance.close();
            }
        });
        $('.modal').each(function () {
            let instance = M.Modal.getInstance(this);
            if (instance && instance.isOpen) {
                instance.close();
            }
        });
        setTimeout(reconcilePageScroll, 260);
    };
    $('.sidenav').sidenav({
        draggable: true,
        preventScrolling: true,
        onOpenStart: function () {
            $('body').addClass('mobile-sidenav-open');
        },
        onCloseStart: reconcilePageScroll,
        onCloseEnd: reconcilePageScroll
    });
    reconcilePageScroll();
    $(window).on('pagehide pageshow orientationchange', closeOpenComponents);
    $(document).on('click', '#mobile-nav a.sidenav-close', function () {
        closeOpenComponents();
    });

    /* 修复文章卡片 div 的宽度. */
    let fixPostCardWidth = function (srcId, targetId) {
        let srcDiv = $('#' + srcId);
        if (srcDiv.length === 0) {
            return;
        }

        let w = srcDiv.width();
        if (w >= 450) {
            w = w + 21;
        } else if (w >= 350 && w < 450) {
            w = w + 18;
        } else if (w >= 300 && w < 350) {
            w = w + 16;
        } else {
            w = w + 14;
        }
        $('#' + targetId).width(w);
    };

    /**
     * 修复footer部分的位置，使得在内容比较少时，footer也会在底部.
     */
    let fixFooterPosition = function () {
        $('.content').css('min-height', window.innerHeight - 165);
    };

    /**
     * 修复样式.
     */
    let fixStyles = function () {
        fixPostCardWidth('navContainer');
        fixPostCardWidth('artDetail', 'prenext-posts');
        fixFooterPosition();
    };
    fixStyles();

    /*调整屏幕宽度时重新设置文章列的宽度，修复小间距问题*/
    $(window).resize(function () {
        fixStyles();
    });

    /*初始化瀑布流布局*/
    $('#articles').masonry({
        itemSelector: '.article'
    });

    AOS.init({
        easing: 'ease-in-out-sine',
        duration: 700,
        delay: 100
    });

    /*文章内容详情的一些初始化特性*/
    let articleInit = function () {
        $('#articleContent a').attr('target', '_blank');

        $('#articleContent img').each(function () {
            let imgPath = $(this).attr('src');
            $(this).wrap('<div class="img-item" data-src="' + imgPath + '" data-sub-html=".caption"></div>');
            // 图片添加阴影
            $(this).addClass("img-shadow img-margin");
            // 图片添加字幕
            let alt = $(this).attr('alt');
            let title = $(this).attr('title');
            let captionText = "";
            // 如果alt为空，title来替
            if (alt === undefined || alt === "") {
                if (title !== undefined && title !== "") {
                    captionText = title;
                }
            } else {
                captionText = alt;
            }
            // 字幕不空，添加之
            if (captionText !== "") {
                let captionDiv = document.createElement('div');
                captionDiv.className = 'caption';
                let captionEle = document.createElement('b');
                captionEle.className = 'center-caption';
                captionEle.innerText = captionText;
                captionDiv.appendChild(captionEle);
                this.insertAdjacentElement('afterend', captionDiv)
            }
        });
        let articleGalleryOptions = {
            selector: 'this',
            // 启用字幕
            subHtmlSelectorRelative: true
        };
        let $articleImages = $('#articleContent .img-item');
        if ($articleImages.length > 0) {
            $articleImages.lightGallery(articleGalleryOptions);
        }

        let $myGallery = $('#myGallery');
        if ($myGallery.length > 0) {
            $myGallery.lightGallery({
                selector: '.img-item',
                // 启用字幕
                subHtmlSelectorRelative: true
            });
        }

        // progress bar init
        const progressElement = window.document.querySelector('.progress-bar');
        if (progressElement) {
            new ScrollProgress((x, y) => {
                progressElement.style.width = y * 100 + '%';
            });
        }
    };
    articleInit();

    $('.modal').modal({
        preventScrolling: true,
        onOpenStart: function () {
            $('body').addClass('mobile-modal-open');
        },
        onCloseStart: reconcilePageScroll,
        onCloseEnd: reconcilePageScroll
    });
    reconcilePageScroll();

    /*回到顶部*/
    $('#backTop').click(function () {
        $('body,html').animate({scrollTop: 0}, 400);
        return false;
    });

    /* Watch scroll position for header and back-to-top state. */
    let $nav = $('#headNav');
    let $backTop = $('.top-scroll');
    // Refresh navbar state when a page opens in the middle of an article.
    showOrHideNavBg($(window).scrollTop());
    $(window).scroll(function () {
        /* Toggle the back-to-top button according to scroll position. */
        let scroll = $(window).scrollTop();
        showOrHideNavBg(scroll);
    });

    function showOrHideNavBg(position) {
        let showPosition = 100;
        if (position < showPosition) {
            $nav.addClass('nav-transparent');
            $backTop.slideUp(300);
        } else {
            $nav.removeClass('nav-transparent');
            $backTop.slideDown(300);
        }
    }

    	
	$(".nav-menu>li").hover(function(){
		$(this).children('ul').stop(true,true).show();
		 $(this).addClass('nav-show').siblings('li').removeClass('nav-show');
		
	},function(){
		$(this).children('ul').stop(true,true).hide();
		$('.nav-item.nav-show').removeClass('nav-show');
	})
	
    $('.m-nav-item>a').on('click',function(){
            if ($(this).next('ul').css('display') == "none") {
                $('.m-nav-item').children('ul').slideUp(300);
                $(this).next('ul').slideDown(100);
                $(this).parent('li').addClass('m-nav-show').siblings('li').removeClass('m-nav-show');
            }else{
                $(this).next('ul').slideUp(100);
                $('.m-nav-item.m-nav-show').removeClass('m-nav-show');
            }
    });

    // 初始化加载 tooltipped.
    $('.tooltipped').tooltip();
});

// Suggest dark mode on desktop at night.
setTimeout(function () {
    if (
        window.innerWidth > 601 &&
        (new Date().getHours() >= 19 || new Date().getHours() < 7) &&
        !$('body').hasClass('DarkMode')
    ) {
        let toastHTML = '<span style="color:#97b8b2;border-radius:10px;"><i class="fa fa-bell" aria-hidden="true"></i> Dark mode may be easier to read at night.</span>';
        M.toast({html: toastHTML});
    }
}, 2200);

// Apply saved dark-mode preference.
if (localStorage.getItem('isDark') === '1') {
    document.body.classList.add('DarkMode');
    $('#sum-moon-icon').addClass("fa-sun").removeClass('fa-moon')
} else {
    document.body.classList.remove('DarkMode');
    $('#sum-moon-icon').removeClass("fa-sun").addClass('fa-moon')
}
